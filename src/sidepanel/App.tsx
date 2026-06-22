import { useState } from 'react'
import './App.css'
import { waitForElementByText } from '@/utils'

const FEISHU_MESSAGES_URL = 'https://feishu.cn/messages'

export default function App () {
  const [needOpenFeishu, setNeedOpenFeishu] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleInject = async () => {
    setNeedOpenFeishu(false)
    setStatus(null)

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      console.log(isFeishuMessengerUrl((tab as any).url), 'isFeishuMessengerUrl(tab.url)')
      if (!tab?.id || !tab.url || !isFeishuMessengerUrl(tab.url)) {
        setNeedOpenFeishu(true)
        return
      }

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: async () => {
          function findElementByText (text: string) {
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_ELEMENT
            )

            while (walker.nextNode()) {
              const el = walker.currentNode

              if (el.textContent?.trim() === text) {
                return el
              }
            }

            return null
          }

          async function waitForElementByText (
            text: string,
            {
              timeout = 10000,
              interval = 300,
            } = {}
          ): Promise<any> {
            const start = Date.now()

            while (Date.now() - start < timeout) {
              const el = findElementByText(text)

              if (el) {
                return el
              }

              await new Promise(resolve =>
                setTimeout(resolve, interval)
              )
            }

            return null
          }

          function sleep (ms: any) {
            return new Promise((r) => setTimeout(r, ms))
          }

          let el: any;
          el = await waitForElementByText("通讯录");
          el?.click();
          await sleep(800)

          el = await waitForElementByText("组织内联系人");
          el?.click();
          await sleep(800)

          async function run(users: any[]) {
            
            function getGroupPath() {
              return [...document.querySelectorAll('.breadcrumb-item')]
                .map(i => i.textContent.trim())
                .join('-')
            }
          
            function collectUsers() {
              document.querySelectorAll('.avatarCard-title').forEach(el => {
                const name = el.querySelector('.name')?.textContent?.trim()
                const tag = el.querySelector('.ud__tag')?.textContent?.trim() || ''
          
                if (!name) return
                const target = users.find((i: any) => i.name === name)
                if (target) {
                  target.group.push(getGroupPath())
                  return
                }
                users.push({
                  name,
                  tag,
                  group: [getGroupPath()]
                })
              })
            }
          
            const waitForRefresh = async (prev: string) => {
              const start = Date.now()
          
              while (Date.now() - start < 10000) {
                if (document.body.innerText !== prev) return
                await sleep(300)
              }
            }
          
            async function walk() {
              collectUsers()
            
              const groups = [...document.querySelectorAll('.department_content')]
            
              for (let i = 0; i < groups.length; i++) {
                const groups = [...document.querySelectorAll('.department_content')]
                const g = groups[i]
            
                if (!g) return
            
                const prev = document.body.innerText
            
                console.log('click index:', i, g)
            
                g.click()
            
                await waitForRefresh(prev)
                await sleep(500)
            
                await walk()
            
                const back =
                  [...document.querySelectorAll('.breadcrumb-item')].at(-2)
            
                back?.click()
                await sleep(800)
              }
            }
          
            await walk()
          
            return users
          }
          (window as any)._users = []
          return await run((window as any)._users)  
        },
      })

      setStatus('已注入并尝试点击「通讯录」')
    }
    catch (err) {
      setNeedOpenFeishu(true)
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const handleOpenFeishu = () => {
    chrome.tabs.create({ url: FEISHU_MESSAGES_URL })
    setNeedOpenFeishu(false)
  }

  return (
    <div className="app">
      <h1 className="title">飞书组织对比</h1>
      <button type="button" className="primary-btn" onClick={handleInject}>
        注入并点击通讯录
      </button>
      {needOpenFeishu && (
        <div className="prompt">
          <p>当前页面不是飞书 Messenger，请先打开飞书消息页后再试。</p>
          <button type="button" className="link-btn" onClick={handleOpenFeishu}>
            打开 {FEISHU_MESSAGES_URL}
          </button>
        </div>
      )}
      {status && <p className="status">{status}</p>}
    </div>
  )
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