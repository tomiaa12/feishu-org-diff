import { useEffect, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type GridOptions,
} from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import './App.css'
import {
  clearSnapshots,
  deleteSnapshot,
  getSnapshots,
  parseSnapshotUsers,
  saveSnapshot,
  type OrgUser,
  type UserSnapshot,
} from './db'

ModuleRegistry.registerModules([AllCommunityModule])

const FEISHU_MESSAGES_URL = 'https://feishu.cn/messages'

type ActiveTab = 'current' | 'diff' | 'history'
type CollectState = 'idle' | 'collecting' | 'interrupted' | 'completed'
type CollectMessage =
  | { type: 'FEISHU_ORG_DIFF_PROGRESS', runId: string, users: OrgUser[] }
  | { type: 'FEISHU_ORG_DIFF_DONE', runId: string, users: OrgUser[] }

interface DiffRow {
  name: string
  tag: string
  change: '新来的' | '跑路了'
}

const defaultGridOptions: GridOptions = {
  animateRows: false,
  suppressCellFocus: true,
  suppressScrollOnNewData: true,
  rowHeight: 34,
  headerHeight: 36,
}

export default function App () {
  const [needOpenFeishu, setNeedOpenFeishu] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [isCollecting, setIsCollecting] = useState(false)
  const [collectState, setCollectState] = useState<CollectState>('idle')
  const [activeTab, setActiveTab] = useState<ActiveTab>('current')
  const [currentUsers, setCurrentUsers] = useState<OrgUser[]>([])
  const [snapshots, setSnapshots] = useState<UserSnapshot[]>([])
  const [baseSnapshotId, setBaseSnapshotId] = useState<number | null>(null)
  const [compareSnapshotId, setCompareSnapshotId] = useState<number | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const currentUsersRef = useRef<OrgUser[]>([])

  useEffect(() => {
    refreshSnapshots()
  }, [])

  useEffect(() => {
    const nextBase = snapshots[0]?.id ?? null
    const nextCompare = snapshots[1]?.id ?? snapshots[0]?.id ?? null

    setBaseSnapshotId(current => snapshots.some(snapshot => snapshot.id === current) ? current : nextBase)
    setCompareSnapshotId(current => snapshots.some(snapshot => snapshot.id === current) ? current : nextCompare)
  }, [snapshots])

  useEffect(() => {
    const listener = (message: CollectMessage) => {
      if (!activeRunIdRef.current || message.runId !== activeRunIdRef.current) return

      if (message.type === 'FEISHU_ORG_DIFF_PROGRESS') {
        updateCurrentUsers(message.users)
        setStatus(`采集中，已发现 ${message.users.length} 人`)
      }

      if (message.type === 'FEISHU_ORG_DIFF_DONE') {
        updateCurrentUsers(message.users)
      }
    }

    chrome.runtime.onMessage.addListener(listener)

    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const userColumnDefs = useMemo<ColDef<OrgUser>[]>(() => [
    { field: 'name', headerName: '姓名', minWidth: 120, flex: 1 },
    { field: 'tag', headerName: '标签', width: 90 },
    {
      field: 'group',
      headerName: '部门路径',
      minWidth: 220,
      flex: 2,
      valueFormatter: ({ value }) => Array.isArray(value) ? value.join('；') : '',
      tooltipValueGetter: ({ value }) => Array.isArray(value) ? value.join('；') : '',
    },
  ], [])

  const diffColumnDefs = useMemo<ColDef<DiffRow>[]>(() => [
    { field: 'change', headerName: '变化', width: 92 },
    { field: 'name', headerName: '姓名', minWidth: 120, flex: 1 },
    { field: 'tag', headerName: '标签', width: 90 },
  ], [])

  const userGridOptions = useMemo<GridOptions<OrgUser>>(() => ({
    ...defaultGridOptions,
    getRowId: ({ data }) => data.name,
  }), [])

  const diffGridOptions = useMemo<GridOptions<DiffRow>>(() => ({
    ...defaultGridOptions,
    getRowId: ({ data }) => `${data.change}-${data.name}`,
  }), [])

  const currentDisplayUsers = useMemo(
    () => [...currentUsers].reverse(),
    [currentUsers],
  )

  const baseSnapshot = useMemo(
    () => snapshots.find(snapshot => snapshot.id === baseSnapshotId),
    [baseSnapshotId, snapshots],
  )
  const compareSnapshot = useMemo(
    () => snapshots.find(snapshot => snapshot.id === compareSnapshotId),
    [compareSnapshotId, snapshots],
  )

  const diffRows = useMemo<DiffRow[]>(() => {
    if (!baseSnapshot || !compareSnapshot) return []

    const baseTagByName = new Map(
      parseSnapshotUsers(baseSnapshot).map(user => [user.name, user.tag]),
    )
    const compareTagByName = new Map(
      parseSnapshotUsers(compareSnapshot).map(user => [user.name, user.tag]),
    )
    const baseNames = new Set(baseSnapshot.names)
    const compareNames = new Set(compareSnapshot.names)
    const added = baseSnapshot.names
      .filter(name => !compareNames.has(name))
      .map(name => ({
        name,
        tag: baseTagByName.get(name) ?? '',
        change: '新来的' as const,
      }))
    const removed = compareSnapshot.names
      .filter(name => !baseNames.has(name))
      .map(name => ({
        name,
        tag: compareTagByName.get(name) ?? '',
        change: '跑路了' as const,
      }))

    return [...added, ...removed]
  }, [baseSnapshot, compareSnapshot])

  const handleInject = async () => {
    setNeedOpenFeishu(false)
    setStatus(null)
    setCollectState('collecting')
    updateCurrentUsers([])
    setActiveTab('current')

    const nextRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    activeRunIdRef.current = nextRunId

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

      if (!tab?.id || !tab.url || !isFeishuMessengerUrl(tab.url)) {
        setNeedOpenFeishu(true)
        setCollectState('idle')
        return
      }

      setIsCollecting(true)
      setStatus('开始采集组织通讯录')

      const [injectionResult] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'ISOLATED',
        args: [nextRunId],
        func: async (currentRunId: string) => {
          async function waitForVisible () {
            while (document.visibilityState !== 'visible') {
              await new Promise<void>(resolve => {
                const onVisible = () => {
                  if (document.visibilityState !== 'visible') return
                  document.removeEventListener('visibilitychange', onVisible)
                  resolve()
                }

                document.addEventListener('visibilitychange', onVisible)
              })
            }
          }

          function findElementByText (text: string) {
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_ELEMENT,
            )

            while (walker.nextNode()) {
              const el = walker.currentNode

              if (el.textContent?.trim() === text) {
                return el as HTMLElement
              }
            }

            return null
          }

          async function waitForElementByText (
            text: string,
            {
              timeout = 10000,
              interval = 300,
            } = {},
          ): Promise<HTMLElement | null> {
            const start = Date.now()

            while (Date.now() - start < timeout) {
              await waitForVisible()
              const el = findElementByText(text)

              if (el) return el

              await new Promise(resolve => setTimeout(resolve, interval))
            }

            return null
          }

          function sleep (ms: number) {
            return new Promise(resolve => setTimeout(resolve, ms))
          }

          function getGroupPath () {
            return [...document.querySelectorAll('.breadcrumb-item')]
              .map(item => item.textContent?.trim())
              .filter(Boolean)
              .join('-')
          }

          function sendProgress (users: OrgUser[], done = false) {
            chrome.runtime.sendMessage({
              type: done ? 'FEISHU_ORG_DIFF_DONE' : 'FEISHU_ORG_DIFF_PROGRESS',
              runId: currentRunId,
              users,
            })
          }

          async function run () {
            const userMap = new Map<string, OrgUser>()
            let lastSentCount = 0

            function collectUsers () {
              let changed = false
              const groupPath = getGroupPath()

              document.querySelectorAll('.avatarCard-title').forEach(el => {
                const name = el.querySelector('.name')?.textContent?.trim()
                const tag = el.querySelector('.ud__tag')?.textContent?.trim() || ''

                if (!name) return

                const target = userMap.get(name)

                if (target) {
                  if (groupPath && !target.group.includes(groupPath)) {
                    target.group.push(groupPath)
                    changed = true
                  }
                  return
                }

                userMap.set(name, {
                  name,
                  tag,
                  group: groupPath ? [groupPath] : [],
                })
                changed = true
              })

              const users = [...userMap.values()]

              if (changed || users.length !== lastSentCount) {
                lastSentCount = users.length
                sendProgress(users)
              }
            }

            const waitForRefresh = async (prev: string) => {
              let visibleStart = Date.now()

              while (Date.now() - visibleStart < 10000) {
                if (document.visibilityState !== 'visible') {
                  await waitForVisible()
                  visibleStart = Date.now()
                }
                if (document.body.innerText !== prev) return
                await sleep(300)
              }
            }

            async function walk () {
              collectUsers()

              const groups = [...document.querySelectorAll('.department_content')]

              for (let i = 0; i < groups.length; i++) {
                const freshGroups = [...document.querySelectorAll('.department_content')]
                const group = freshGroups[i] as HTMLElement | undefined

                if (!group) return

                await waitForVisible()
                const prev = document.body.innerText
                group.click()

                await waitForRefresh(prev)
                await sleep(500)
                await walk()

                const breadcrumbs = [...document.querySelectorAll('.breadcrumb-item')]
                const back = breadcrumbs[breadcrumbs.length - 2] as HTMLElement | undefined

                await waitForVisible()
                back?.click()
                await sleep(800)
              }
            }

            await walk()

            const users = [...userMap.values()]
            sendProgress(users, true)

            return users
          }

          await waitForVisible()
          let el = await waitForElementByText('通讯录')
          el?.click()
          await sleep(800)

          await waitForVisible()
          el = await waitForElementByText('组织内联系人')
          el?.click()
          await sleep(800)

          return await run()
        },
      })

      const users = (injectionResult.result ?? []) as OrgUser[]
      updateCurrentUsers(users)

      const snapshot = await saveSnapshot(users)
      await refreshSnapshots(snapshot.id)
      setCollectState('completed')
      setStatus(`采集完成，已保存 ${users.length} 人`)
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      if (currentUsersRef.current.length > 0) {
        setCollectState('interrupted')
        setStatus(`采集被打断，当前列表有 ${currentUsersRef.current.length} 人，尚未保存。${message}`)
      }
      else {
        setCollectState('idle')
        setNeedOpenFeishu(true)
        setStatus(message)
      }
    }
    finally {
      setIsCollecting(false)
      activeRunIdRef.current = null
    }
  }

  const handleOpenFeishu = () => {
    chrome.tabs.create({ url: FEISHU_MESSAGES_URL })
    setNeedOpenFeishu(false)
  }

  const updateCurrentUsers = (users: OrgUser[]) => {
    currentUsersRef.current = users
    setCurrentUsers(users)
  }

  const handleSaveInterrupted = async () => {
    const users = currentUsersRef.current

    if (users.length === 0) return

    const snapshot = await saveSnapshot(users)
    await refreshSnapshots(snapshot.id)
    setCollectState('completed')
    setStatus(`已手动保存 ${users.length} 人`)
  }

  const handleDeleteSnapshot = async (id: number) => {
    await deleteSnapshot(id)
    await refreshSnapshots()
  }

  const handleClearSnapshots = async () => {
    await clearSnapshots()
    await refreshSnapshots()
  }

  const refreshSnapshots = async (preferredBaseId?: number) => {
    const nextSnapshots = await getSnapshots()
    setSnapshots(nextSnapshots)

    if (preferredBaseId) {
      setBaseSnapshotId(preferredBaseId)
      setCompareSnapshotId(nextSnapshots.find(snapshot => snapshot.id !== preferredBaseId)?.id ?? preferredBaseId)
    }
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div>
          <h1 className="title">飞书组织对比</h1>
          <p className="subtitle">采集通讯录快照，查看历史增减</p>
        </div>
        <button type="button" className="primary-btn" onClick={handleInject} disabled={isCollecting}>
          {isCollecting ? '采集中' : '开始采集'}
        </button>
      </header>

      {needOpenFeishu && (
        <div className="prompt">
          <p>当前页面不是飞书 Messenger，请先打开飞书消息页后再试。</p>
          <button type="button" className="link-btn" onClick={handleOpenFeishu}>
            打开 {FEISHU_MESSAGES_URL}
          </button>
        </div>
      )}

      {status && <p className="status">{status}</p>}

      <div className="tabs" role="tablist" aria-label="视图">
        <button
          type="button"
          className={activeTab === 'current' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('current')}
        >
          当前列表
        </button>
        <button
          type="button"
          className={activeTab === 'diff' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('diff')}
        >
          历史对比
        </button>
        <button
          type="button"
          className={activeTab === 'history' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('history')}
        >
          历史管理
        </button>
      </div>

      {activeTab === 'current' && (
        <section className="panel">
          <div className="panel-head">
            <strong>当前采集</strong>
            <span>{currentUsers.length} 人</span>
          </div>
          {collectState === 'interrupted' && currentUsers.length > 0 && (
            <div className="save-prompt">
              <span>采集被打断，当前数据只在页面内存中，刷新会丢失。</span>
              <button type="button" className="link-btn" onClick={handleSaveInterrupted}>
                保存到插件
              </button>
            </div>
          )}
          <div className="ag-theme-quartz table">
            <AgGridReact
              rowData={currentDisplayUsers}
              columnDefs={userColumnDefs}
              gridOptions={userGridOptions}
            />
          </div>
        </section>
      )}

      {activeTab === 'diff' && (
        <section className="panel">
          <div className="compare-controls">
            <label>
              <span>当前</span>
              <select
                value={baseSnapshotId ?? ''}
                onChange={event => setBaseSnapshotId(Number(event.target.value))}
              >
                {snapshots.map(snapshot => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {formatSnapshotLabel(snapshot)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>上次</span>
              <select
                value={compareSnapshotId ?? ''}
                onChange={event => setCompareSnapshotId(Number(event.target.value))}
              >
                {snapshots.map(snapshot => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {formatSnapshotLabel(snapshot)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="summary">
            <span>当前 {baseSnapshot?.userCount ?? 0} 人</span>
            <span>上次 {compareSnapshot?.userCount ?? 0} 人</span>
            <span>变化 {diffRows.length} 人</span>
          </div>

          <div className="ag-theme-quartz diff-table">
            <AgGridReact
              rowData={diffRows}
              columnDefs={diffColumnDefs}
              gridOptions={diffGridOptions}
            />
          </div>

          {/* <div className="panel-head history-head">
            <strong>基准快照用户</strong>
            <span>{selectedSnapshotUsers.length} 人</span>
          </div>
          <div className="ag-theme-quartz table compact">
            <AgGridReact
              rowData={selectedSnapshotUsers}
              columnDefs={userColumnDefs}
              gridOptions={userGridOptions}
            />
          </div> */}
        </section>
      )}

      {activeTab === 'history' && (
        <section className="panel">
          <div className="panel-head">
            <strong>历史快照</strong>
            <button
              type="button"
              className="danger-btn"
              onClick={handleClearSnapshots}
              disabled={snapshots.length === 0}
            >
              清空全部
            </button>
          </div>
          <div className="history-list">
            {snapshots.map(snapshot => (
              <div className="history-row" key={snapshot.id}>
                <div>
                  <strong>{formatSnapshotLabel(snapshot)}</strong>
                  <span>ID {snapshot.id}</span>
                </div>
                <button type="button" className="danger-btn" onClick={() => handleDeleteSnapshot(snapshot.id)}>
                  删除
                </button>
              </div>
            ))}
            {snapshots.length === 0 && <p className="empty">还没有历史快照</p>}
          </div>
        </section>
      )}
    </div>
  )
}

function formatSnapshotLabel (snapshot: UserSnapshot): string {
  return `${new Date(snapshot.createdAt).toLocaleString()} · ${snapshot.userCount} 人`
}

function isFeishuMessengerUrl (url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url)
    return hostname.includes('feishu.cn') && pathname.includes('/next')
  }
  catch {
    return false
  }
}
