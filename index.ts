import addHeader from './utils/addHeader'

type Config = {
  timeout?: number // 请求超时时间
  retries?: number // 请求超时重试次数
  retryInterval?: number // 添加重试间隔时间参数
  retryOnFail?: boolean // 是否开启错误重试
  baseURL?: string // 基础URL
}

interface RequestOptions extends RequestInit {
  _timeout?: number
  _retries?: number
  _retryOnFail?: boolean
  _retryInterval?: number
  _apiUrl?: string
}

interface InterceptorManager<T> {
  fulfilled: (value: T) => T | Promise<T>
  rejected?: (error: any) => any
}

class FetchWrapper {
  private timeout: number
  private retries: number
  private baseURL: string
  private retryInterval: number
  private retryOnFail: boolean
  private responseInterceptors: InterceptorManager<Response>[] = []
  private requestInterceptors: InterceptorManager<RequestOptions>[] = []

  constructor(config: Config) {
    this.timeout = config.timeout || 5000 // 默认超时时间为5000毫秒
    this.retries = config.retries || 3 // 默认重试次数为0
    this.baseURL = config.baseURL || '' // 如果没有配置baseURL，默认为空
    this.retryInterval = config.retryInterval || 1000 // 如果未设置，默认为1000毫秒
    this.retryOnFail = config.retryOnFail !== undefined ? config.retryOnFail : false // 初始化错误重试开关，默认值为 false
  }

  useRequestInterceptor(
    fulfilled: (options: RequestOptions) => RequestOptions | Promise<RequestOptions>,
    rejected?: (error: any) => any
  ) {
    this.requestInterceptors.push({ fulfilled, rejected })
  }

  useResponseInterceptor(
    fulfilled: (response: Response) => Response | Promise<Response>,
    rejected?: (error: any) => any
  ) {
    this.responseInterceptors.push({ fulfilled, rejected })
  }

  private async applyInterceptors<T>(value: T, interceptors: InterceptorManager<T>[]): Promise<T> {
    for (const interceptor of interceptors) {
      if (interceptor.fulfilled) {
        try {
          value = await interceptor.fulfilled(value)
        } catch (error) {
          if (interceptor.rejected) {
            value = interceptor.rejected(error)
            break
          }
          throw error
        }
      }
    }
    return value
  }

  private async fetchWithTimeout(resource: string, options: RequestOptions) {
    const timeout = options._timeout !== undefined ? options._timeout : this.timeout

    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeout)
    options.signal = controller.signal

    const finalResource =
      options._apiUrl === undefined ? this.baseURL + resource : options._apiUrl + resource

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
          // 根据HTTP状态码来决定是否抛出异常以触发重试
          // 5xx 错误代码进行重试 ， 其他4xx错误，通常不应重试
          if (status >= 500) {
            throw new Error(`Network response was not ok: ${status}`)
          } else if (status === 429) {
            // 请求过于频繁，应根据响应中的重试时间后再重试
            // 获取服务器建议的重试时间 ...
            if (response.headers.has('Retry-After')) {
              // 使用服务器指定的重试时间
              interval = parseInt(response.headers.get('Retry-After')!, 10) * 1000
            }
            throw new Error(`Rate Limit Exceeded: ${status}`)
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
    // 使用全局设置的错误重试开关，除非为当前请求显式设置了该值
    const retryOnFail = options._retryOnFail !== undefined ? options._retryOnFail : this.retryOnFail

    options = await this.applyInterceptors(options, this.requestInterceptors)

    // 如果错误重试已关闭，则直接调用 fetchWithTimeout，不进入重试逻辑
    if (!retryOnFail) {
      try {
        const response = await this.fetchWithTimeout(resource, options)
        if (!response.ok) {
          throw new Error('Network response was not ok')
        }
        return await this.applyInterceptors(response, this.responseInterceptors)
      } catch (error) {
        // 直接处理rejected拦截器逻辑
        for (const interceptor of this.responseInterceptors) {
          if (interceptor.rejected) {
            try {
              // 尽量确保传递的是期望的错误类型或兼容类型
              return await interceptor.rejected(error)
            } catch (newError) {
              // 如果拦截器中再次抛出异常，则可以决定是否要处理或抛出
              console.error(newError)
              throw newError
            }
          }
        }

        // 如果没有任何rejected拦截器，或者没有任何一个能处理错误，直接抛出原始错误
        throw error
      }
    }

    // 如果错误重试已开启，继续使用重试逻辑
    try {
      const response = await this.retryFetch(resource, options)
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      return await this.applyInterceptors(response, this.responseInterceptors)
    } catch (error) {
      // 直接处理rejected拦截器逻辑
      for (const interceptor of this.responseInterceptors) {
        if (interceptor.rejected) {
          try {
            // 尽量确保传递的是期望的错误类型或兼容类型
            return await interceptor.rejected(error)
          } catch (newError) {
            // 如果拦截器中再次抛出异常，则可以决定是否要处理或抛出
            console.error(newError)
            throw newError
          }
        }
      }

      // 如果没有任何rejected拦截器，或者没有任何一个能处理错误，直接抛出原始错误
      throw error
    }
  }

  // 封装GET请求
  async get(resource: string, options: RequestOptions = {}) {
    const defaultOptions = { method: 'GET' }
    options = Object.assign(defaultOptions, options)
    return this.request(resource, options)
  }

  // 封装POST请求
  async post(resource: string, body: any, options: RequestOptions = {}) {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    const defaultOptions = {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }
    options = Object.assign(defaultOptions, options)

    // 如果用户自定义了headers，保留用户定义的内容
    if (options.headers) {
      const optionHeaders = options.headers
      if (optionHeaders instanceof Headers) {
        optionHeaders.forEach((value, key) => {
          addHeader(headers, key, value)
        })
      } else if (Array.isArray(optionHeaders)) {
        optionHeaders.forEach(header => {
          if (header.length === 2) {
            addHeader(headers, header[0], header[1])
          }
        })
      } else {
        Object.entries(optionHeaders).forEach(([key, value]) => {
          addHeader(headers, key, value)
        })
      }
    }
    options.headers = headers
    return this.request(resource, options)
  }
}

export default FetchWrapper
