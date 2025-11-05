import InterceptorManager from './utils/interceptorManager'

export type Config = {
  timeout?: number // 请求超时时间
  retries?: number // 请求超时重试次数
  retryInterval?: number // 添加重试间隔时间参数
  retryOnFail?: boolean // 是否开启错误重试
  apiUrl?: string // 基础URL
  withHeader?: boolean // 是否携带自定义header
  autoParseJSON?: boolean // 是否自动解析JSON响应
}

export interface RequestOptions extends RequestInit {
  _timeout?: number
  _retries?: number
  _retryInterval?: number
  _retryOnFail?: boolean
  _apiUrl?: string
  _withHeader?: boolean
  _isReturnNativeResponse?: boolean
  _autoParseJSON?: boolean
}

interface RequestContext {
  url: string
  options: RequestOptions
}

interface ResponseContext {
  response: Response
  options: RequestOptions
}

class FetchWrapper {
  private timeout: number
  private retries: number
  private apiUrl: string
  private retryInterval: number
  private retryOnFail: boolean
  private autoParseJSON: boolean
  public interceptors = {
    request: new InterceptorManager<RequestContext>(),
    response: new InterceptorManager<ResponseContext>()
  }

  constructor(config: Config) {
    this.timeout = config.timeout || 5000 // 默认超时时间为5000毫秒
    this.retries = config.retries || 0 // 默认重试次数为0
    this.apiUrl = config.apiUrl || '' // 如果没有配置baseURL，默认为空
    this.retryInterval = config.retryInterval || 1000 // 如果未设置，默认为1000毫秒
    this.retryOnFail = config.retryOnFail !== undefined ? config.retryOnFail : false // 初始化错误重试开关，默认值为 false
    this.autoParseJSON = config.autoParseJSON !== undefined ? config.autoParseJSON : false // 初始化自动解析JSON开关，默认值为 false
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

  async request<T = Response>(resource: string, options: RequestOptions = {}): Promise<T> {
    const retryOnFail = options._retryOnFail !== undefined ? options._retryOnFail : this.retryOnFail
    const autoParseJSON =
      options._autoParseJSON !== undefined ? options._autoParseJSON : this.autoParseJSON

    const requestContext: RequestContext = { url: resource, options }

    try {
      const resolvedRequestContext = await this.interceptors.request.runHandlers(requestContext)

      let response: Response
      if (!retryOnFail) {
        response = await this.fetchWithTimeout(
          resolvedRequestContext.url,
          resolvedRequestContext.options
        )
      } else {
        response = await this.retryFetch(resolvedRequestContext.url, resolvedRequestContext.options)
      }

      const responseContext: ResponseContext = {
        response,
        options: resolvedRequestContext.options
      }
      const resolvedResponseContext = await this.interceptors.response.runHandlers(responseContext)

      // 如果启用了自动解析JSON，则解析响应体
      if (autoParseJSON) {
        return (await resolvedResponseContext.response.json()) as T
      }

      return resolvedResponseContext.response as T
    } catch (error) {
      const errorContext = { error, request: requestContext }
      console.error('Request failed:', errorContext)
      throw error
    }
  }

  // 封装 GET 方法
  async get<T = Response>(
    resource: string,
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<T> {
    return this.request<T>(resource, { ...options, method: 'GET' })
  }

  // 封装 POST 方法
  async post<T = Response>(
    resource: string,
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<T> {
    return this.request<T>(resource, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      method: 'POST',
      body: options.body
    })
  }

  // 封装 PUT 方法
  async put<T = Response>(
    resource: string,
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<T> {
    return this.request<T>(resource, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      method: 'PUT',
      body: options.body
    })
  }

  // 封装 DELETE 方法
  async delete<T = Response>(
    resource: string,
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<T> {
    return this.request<T>(resource, { ...options, method: 'DELETE' })
  }
}

export default FetchWrapper
