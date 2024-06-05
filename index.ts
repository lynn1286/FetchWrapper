import InterceptorManager from './utils/interceptorManager'

type Config = {
  timeout?: number // 请求超时时间
  retries?: number // 请求超时重试次数
  retryInterval?: number // 添加重试间隔时间参数
  retryOnFail?: boolean // 是否开启错误重试
  apiUrl?: string // 基础URL
  withHeader?: boolean // 是否携带自定义header
}

export interface RequestOptions extends RequestInit {
  _timeout?: number
  _retries?: number
  _retryInterval?: number
  _retryOnFail?: boolean
  _apiUrl?: string
  _withHeader?: boolean
}

class FetchWrapper {
  private timeout: number
  private retries: number
  private apiUrl: string
  private retryInterval: number
  private retryOnFail: boolean
  public interceptors = {
    request: new InterceptorManager<[string, RequestOptions]>(),
    response: new InterceptorManager<Response>()
  }

  constructor(config: Config) {
    this.timeout = config.timeout || 5000 // 默认超时时间为5000毫秒
    this.retries = config.retries || 3 // 默认重试次数为0
    this.apiUrl = config.apiUrl || '' // 如果没有配置baseURL，默认为空
    this.retryInterval = config.retryInterval || 1000 // 如果未设置，默认为1000毫秒
    this.retryOnFail = config.retryOnFail !== undefined ? config.retryOnFail : false // 初始化错误重试开关，默认值为 false
  }

  private async fetchWithTimeout(resource: string, options: RequestOptions) {
    const timeout = options._timeout !== undefined ? options._timeout : this.timeout

    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeout)
    options.signal = controller.signal

    const finalResource =
      options._apiUrl === undefined ? this.apiUrl + resource : options._apiUrl + resource

    try {
      const response = await fetch(finalResource, options)
      clearTimeout(id)
      return response
    } catch (error) {
      throw new Error('Request timed out')
    }
  }

  private async retryFetch(resource: string, options: RequestOptions): Promise<Response> {
    const retries = options._retries !== undefined ? options._retries : this.retries

    let interval =
      options._retryInterval !== undefined ? options._retryInterval : this.retryInterval

    for (let i = 0; i <= retries; i++) {
      try {
        const response = await this.fetchWithTimeout(resource, options)

        if (!response.ok) {
          const status = response.status
          if (status >= 500 || status === 429) {
            if (status === 429 && response.headers.has('Retry-After')) {
              interval = parseInt(response.headers.get('Retry-After')!, 10) * 1000
            }
            throw new Error(`Network response was not ok: ${status}`)
          }
        }
        return response
      } catch (error) {
        console.error(`Attempt ${i + 1} failed: ${(error as Error).message}`)
        if (i < retries) {
          await new Promise(resolve => setTimeout(resolve, interval))
        } else {
          throw error
        }
      }
    }
    throw new Error('Maximum retries exceeded')
  }

  async request(resource: string, options: RequestOptions = {}): Promise<Response> {
    const retryOnFail = options._retryOnFail !== undefined ? options._retryOnFail : this.retryOnFail

    try {
      const [resolvedResource, resolvedOptions] = await this.interceptors.request.runHandlers([
        resource,
        options
      ])

      let response: Response
      if (!retryOnFail) {
        response = await this.fetchWithTimeout(resolvedResource, resolvedOptions)
      } else {
        response = await this.retryFetch(resolvedResource, resolvedOptions)
      }

      return await this.interceptors.response.runHandlers(response)
    } catch (error) {
      console.error('Request failed:', error)
      throw error
    }
  }

  // 封装 GET 方法
  async get(resource: string, options: RequestOptions = {}) {
    return this.request(resource, { ...options, method: 'GET' })
  }

  // 封装 POST 方法
  async post(resource: string, options: RequestOptions = {}) {
    return this.request(resource, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      method: 'POST',
      body: JSON.stringify(options.body)
    })
  }

  // 封装 PUT 方法
  async put(resource: string, options: RequestOptions = {}) {
    return this.request(resource, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      method: 'PUT',
      body: JSON.stringify(options.body)
    })
  }

  // 封装 DELETE 方法
  async delete(resource: string, options: RequestOptions = {}) {
    return this.request(resource, { ...options, method: 'DELETE' })
  }
}

export default FetchWrapper
