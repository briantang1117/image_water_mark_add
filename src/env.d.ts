/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

// iOS WKWebView 原生桥接类型声明
interface WebkitMessageHandler {
  postMessage: (message: Record<string, unknown>) => void
}

interface WebkitMessageHandlers {
  native: WebkitMessageHandler
}

interface Webkit {
  messageHandlers: WebkitMessageHandlers
}

interface Window {
  webkit?: Webkit
  __onImagePicked?: (dataURL: string, fileName: string) => void
}
