# 使用 TypeScript 封装 Fetch 请求

在现代前端开发中，网络请求是一个非常常见的需求。fetch 是一个广泛使用的原生 API，它提供了一个接口来进行网络请求，但其原生功能相对基础，不支持超时、重试等高级特性。因此，我们常常需要对 fetch 进行封装，以满足更复杂的需求。在本文中，我们将介绍如何使用 TypeScript 封装 fetch，并提供一个支持超时、重试和拦截器的类 FetchWrapper。[完整代码](https://github.com/lynn1286/FetchWrapper)

## 设计目标

我们希望封装后的 fetch 请求具有以下功能：

1. 请求超时：能够设置请求的超时时间。
2. 重试机制：在请求失败时，能够进行重试，并支持配置重试次数和重试间隔。
3. 拦截器：支持请求和响应的拦截器，便于在请求前后进行一些额外的处理。
4. 统一的基础 URL：支持配置基础 URL，简化请求路径。
5. 自动解析 JSON：支持自动解析 JSON 响应，简化数据获取流程。

## 实现步骤

### 1. 定义配置类型

首先，我们需要定义配置类型，用于初始化 FetchWrapper 实例时传入的配置参数：

```js
type Config = {
  timeout?: number, // 请求超时时间
  retries?: number, // 请求超时重试次数
  retryInterval?: number, // 添加重试间隔时间参数
  retryOnFail?: boolean, // 是否开启错误重试
  apiUrl?: string, // 基础URL
  withHeader?: boolean, // 是否携带自定义header
  autoParseJSON?: boolean // 是否自动解析JSON响应
}
```

### 2. 定义请求和拦截器类型

接下来，我们定义请求选项和拦截器的类型：

```js
interface RequestOptions extends RequestInit {
  _timeout?: number;
  _retries?: number;
  _retryInterval?: number;
  _retryOnFail?: boolean;
  _apiUrl?: string;
  _withHeader?: boolean;
  _isReturnNativeResponse?: boolean;
  _autoParseJSON?: boolean;
}

interface RequestContext {
  url: string;
  options: RequestOptions;
}

interface ResponseContext {
  response: Response;
  options: RequestOptions;
}
```

### 3. 定义 FetchWrapper 类

我们通过 FetchWrapper 类来封装 fetch 请求。首先，我们定义类的属性，并在构造函数中进行初始化：

```js
class FetchWrapper {
  private timeout: number;
  private retries: number;
  private apiUrl: string;
  private retryInterval: number;
  private retryOnFail: boolean;
  private autoParseJSON: boolean;
  public interceptors = {
    request: new InterceptorManager<RequestContext>(),
    response: new InterceptorManager<ResponseContext>()
  };

  constructor(config: Config) {
    this.timeout = config.timeout || 5000; // 默认超时时间为5000毫秒
    this.retries = config.retries || 0; // 默认重试次数为0
    this.apiUrl = config.apiUrl || ''; // 如果没有配置apiUrl，默认为空
    this.retryInterval = config.retryInterval || 1000; // 如果未设置，默认为1000毫秒
    this.retryOnFail = config.retryOnFail !== undefined ? config.retryOnFail : false; // 初始化错误重试开关，默认值为 false
    this.autoParseJSON = config.autoParseJSON !== undefined ? config.autoParseJSON : false; // 初始化自动解析JSON开关，默认值为 false
  }
}
```

### 4. 拦截器管理器

拦截器通过独立的 `InterceptorManager` 类来管理：

```js
class InterceptorManager<T, E = any> {
  private handlers: Array<Interceptor<T, E>> = [];

  use(fulfilled?: (value: T) => T | Promise<T>, rejected?: (params: { error: E; options: T }) => any): void {
    this.handlers.push({
      fulfilled,
      rejected
    });
  }

  async runHandlers(value: T): Promise<T> {
    for (const { fulfilled, rejected } of this.handlers) {
      try {
        if (fulfilled) {
          value = await fulfilled(value);
        }
      } catch (error) {
        if (rejected) {
          await rejected({ error: error as E, options: value });
        }
        throw error;
      }
    }
    return value;
  }
}
```

### 5. 实现带有超时功能的 fetch

我们通过 fetchWithTimeout 方法来实现带有超时功能的 fetch 请求：

```js
  private async fetchWithTimeout(resource: string, options: RequestOptions) {
    const timeout = options._timeout !== undefined ? options._timeout : this.timeout;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    options.signal = controller.signal;

    const finalResource = options._apiUrl === undefined ? this.apiUrl + resource : options._apiUrl + resource;

    try {
      const response = await fetch(finalResource, options);
      clearTimeout(id);
      return response;
    } catch (error) {
      throw new Error('Request timed out');
    }
  }
```

### 6. 实现重试逻辑

我们通过 retryFetch 方法来实现重试逻辑：

```js
  private async retryFetch(resource: string, options: RequestOptions): Promise<Response> {
    const retries = options._retries !== undefined ? options._retries : this.retries;
    let interval = options._retryInterval !== undefined ? options._retryInterval : this.retryInterval;

    for (let i = 0; i <= retries; i++) {
      try {
        const response = await this.fetchWithTimeout(resource, options);

        if (!response.ok) {
          const status = response.status;
          // 5xx 错误或 429 错误进行重试
          if (status >= 500 || status === 429) {
            // 对于 429 状态码，检查 Retry-After 头
            if (status === 429 && response.headers.has('Retry-After')) {
              interval = parseInt(response.headers.get('Retry-After')!, 10) * 1000;
            }
            throw new Error(`Network response was not ok: ${status}`);
          }
        }
        return response;
      } catch (error) {
        console.error(`Attempt ${i + 1} failed: ${(error as Error).message}`);
        if (i < retries) {
          await new Promise((resolve) => setTimeout(resolve, interval));
        } else {
          throw error;
        }
      }
    }
    throw new Error('Maximum retries exceeded');
  }
```

### 7. 实现 request 方法

我们通过 request 方法来统一处理请求，并根据配置决定是否进行重试。当启用 `autoParseJSON` 时，会自动解析 JSON 响应：

```js
  async request(resource: string, options: RequestOptions = {}): Promise<any> {
    const retryOnFail = options._retryOnFail !== undefined ? options._retryOnFail : this.retryOnFail;
    const autoParseJSON = options._autoParseJSON !== undefined ? options._autoParseJSON : this.autoParseJSON;

    const requestContext: RequestContext = { url: resource, options };

    try {
      // 运行请求拦截器
      const resolvedRequestContext = await this.interceptors.request.runHandlers(requestContext);

      let response: Response;
      if (!retryOnFail) {
        response = await this.fetchWithTimeout(
          resolvedRequestContext.url,
          resolvedRequestContext.options
        );
      } else {
        response = await this.retryFetch(resolvedRequestContext.url, resolvedRequestContext.options);
      }

      // 运行响应拦截器
      const responseContext: ResponseContext = {
        response,
        options: resolvedRequestContext.options
      };
      const resolvedResponseContext = await this.interceptors.response.runHandlers(responseContext);

      // 如果启用了自动解析JSON，则解析响应体
      if (autoParseJSON) {
        return await resolvedResponseContext.response.json();
      }

      return resolvedResponseContext.response;
    } catch (error) {
      const errorContext = { error, request: requestContext };
      console.error('Request failed:', errorContext);
      throw error;
    }
  }
```

### 8. 封装 GET、POST、PUT 和 DELETE 方法

最后，我们提供封装好的 HTTP 方法：

```js
  // 封装 GET 方法
  async get<T = Response>(resource: string, options: Omit<RequestOptions, 'method'> = {}) {
    return this.request(resource, { ...options, method: 'GET' }) as T;
  }

  // 封装 POST 方法
  async post<T = Response>(resource: string, options: Omit<RequestOptions, 'method'> = {}) {
    return this.request(resource, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      method: 'POST',
      body: options.body
    }) as T;
  }

  // 封装 PUT 方法
  async put<T = Response>(resource: string, options: Omit<RequestOptions, 'method'> = {}) {
    return this.request(resource, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      method: 'PUT',
      body: options.body
    }) as T;
  }

  // 封装 DELETE 方法
  async delete<T = Response>(resource: string, options: Omit<RequestOptions, 'method'> = {}) {
    return this.request(resource, { ...options, method: 'DELETE' }) as T;
  }
```

## 使用示例

我们可以通过以下代码来创建并使用 FetchWrapper 实例：

```js
import FetchWrapper from './FetchWrapper'

const config = {
  timeout: 10000, // 超时时间
  retries: 5, // 重试次数
  retryInterval: 2000, // 重试间隔
  retryOnFail: true, // 开启错误重试
  apiUrl: 'https://api.example.com', // 基础URL
  autoParseJSON: true // 自动解析JSON响应
}

const fetchWrapper = new FetchWrapper(config)

// 添加请求拦截器
fetchWrapper.interceptors.request.use(async requestContext => {
  requestContext.options.headers = {
    ...requestContext.options.headers,
    Authorization: 'Bearer token'
  }
  return requestContext
})

// 添加响应拦截器
fetchWrapper.interceptors.response.use(
  responseContext => {
    // 处理响应
    return responseContext
  },
  ({ error, options }) => {
    console.error('Response error:', error)
    throw error
  }
)

// 发送GET请求（启用了 autoParseJSON，直接返回解析后的数据）
fetchWrapper
  .get('/endpoint')
  .then(data => console.log(data)) // 直接获得解析后的数据，无需 .json()
  .catch(error => console.error('Error:', error))

// 发送POST请求
fetchWrapper
  .post('/endpoint', {
    body: JSON.stringify({ key: 'value' })
  })
  .then(data => console.log(data)) // 直接获得解析后的数据
  .catch(error => console.error('Error:', error))

// 如果某个请求需要获取原始 Response 对象，可以单独关闭自动解析
fetchWrapper
  .get('/endpoint', {
    _autoParseJSON: false // 单独关闭自动解析
  })
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error))

// 发送PUT请求
fetchWrapper
  .put('/endpoint', {
    body: JSON.stringify({ key: 'updated value' })
  })
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error))

// 发送DELETE请求
fetchWrapper
  .delete('/endpoint')
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error))
```

### autoParseJSON 功能说明

`autoParseJSON` 配置项可以让您自动解析 JSON 响应，无需手动调用 `.then(response => response.json())`：

- **全局配置**：在创建 FetchWrapper 实例时设置 `autoParseJSON: true`，所有请求都会自动解析 JSON
- **单独控制**：可以通过请求选项中的 `_autoParseJSON` 来覆盖全局配置
- **默认值**：默认为 `false`，保持向后兼容

**使用场景：**

- 当您的 API 主要返回 JSON 数据时，启用全局配置可以简化代码
- 对于需要原始 Response 对象的特殊情况（如处理 Blob、文件下载等），可以单独关闭此功能

通过以上步骤，我们完成了对 fetch 的封装，实现了超时、重试、拦截器等高级特性。希望这篇文章能够帮助你更好地理解和使用 fetch。
