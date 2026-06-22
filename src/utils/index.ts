export function findElementByText (text: string) {
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

export async function waitForElementByText (
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