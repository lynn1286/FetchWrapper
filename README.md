# 使用 TypeScript 封装 Fetch 请求

在现代前端开发中，网络请求是一个非常常见的需求。fetch 是一个广泛使用的原生 API，它提供了一个接口来进行网络请求，但其原生功能相对基础，不支持超时、重试等高级特性。因此，我们常常需要对 fetch 进行封装，以满足更复杂的需求。在本文中，我们将介绍如何使用 TypeScript 封装 fetch，并提供一个支持超时、重试和拦截器的类 FetchWrapper。[完整代码](https://github.com/lynn1286/FetchWrapper)

## 设计目标
我们希望封装后的 fetch 请求具有以下功能：

1. 请求超时：能够设置请求的超时时间。
2. 重试机制：在请求失败时，能够进行重试，并支持配置重试次数和重试间隔。
3. 拦截器：支持请求和响应的拦截器，便于在请求前后进行一些额外的处理。
4. 统一的基础 URL：支持配置基础 URL，简化请求路径。

## 实现步骤

### 1. 定义配置类型
首先，我们需要定义配置类型，用于初始化 FetchWrapper 实例时传入的配置参数：
```js
type Config = {
  timeout?: number; // 请求超时时间
  retries?: number; // 请求超时重试次数
  retryInterval?: number; // 添加重试间隔时间参数
  retryOnFail?: boolean; // 是否开启错误重试
  baseURL?: string; // 基础URL
};
```

### 2. 定义请求和拦截器类型
接下来，我们定义请求选项和拦截器的类型：
```js
interface RequestOptions extends RequestInit {
  _timeout?: number;
  _retries?: number;
  _retryOnFail?: boolean;
  _retryInterval?: number;
  _apiUrl?: string;
}

interface InterceptorManager<T> {
  fulfilled: (value: T) => T | Promise<T>;
  rejected?: (error: any) => any;
}

```

### 3. 定义 FetchWrapper 类
我们通过 FetchWrapper 类来封装 fetch 请求。首先，我们定义类的属性，并在构造函数中进行初始化：
```js
class FetchWrapper {
  private timeout: number;
  private retries: number;
  private baseURL: string;
  private retryInterval: number;
  private retryOnFail: boolean;
  private responseInterceptors: InterceptorManager<Response>[] = [];
  private requestInterceptors: InterceptorManager<RequestOptions>[] = [];

  constructor(config: Config) {
    this.timeout = config.timeout || 5000; // 默认超时时间为5000毫秒
    this.retries = config.retries || 3; // 默认重试次数为3
    this.baseURL = config.baseURL || ''; // 如果没有配置baseURL，默认为空
    this.retryInterval = config.retryInterval || 1000; // 如果未设置，默认为1000毫秒
    this.retryOnFail = config.retryOnFail !== undefined ? config.retryOnFail : false; // 初始化错误重试开关，默认值为 false
  }
}

```

### 4. 添加拦截器方法
我们需要提供添加请求和响应拦截器的方法：
```js
  useRequestInterceptor(
    fulfilled: (
      options: RequestOptions,
    ) => RequestOptions | Promise<RequestOptions>,
    rejected?: (error: any) => any,
  ) {
    this.requestInterceptors.push({ fulfilled, rejected });
  }

  useResponseInterceptor(
    fulfilled: (response: Response) => Response | Promise<Response>,
    rejected?: (error: any) => any,
  ) {
    this.responseInterceptors.push({ fulfilled, rejected });
  }
```

### 5. 应用拦截器
我们通过一个私有方法 applyInterceptors 来应用拦截器：
```js
  private async applyInterceptors<T>(
    value: T,
    interceptors: InterceptorManager<T>[],
  ): Promise<T> {
    for (const interceptor of interceptors) {
      if (interceptor.fulfilled) {
        try {
          value = await interceptor.fulfilled(value);
        } catch (error) {
          if (interceptor.rejected) {
            value = interceptor.rejected(error);
            break;
          }
          throw error;
        }
      }
    }
    return value;
  }

```

### 6. 实现带有超时功能的 fetch
我们通过 fetchWithTimeout 方法来实现带有超时功能的 fetch 请求：
```js
  private async fetchWithTimeout(resource: string, options: RequestOptions) {
    const timeout = options._timeout !== undefined ? options._timeout : this.timeout;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    options.signal = controller.signal;

    const finalResource = options._apiUrl === undefined ? this.baseURL + resource : options._apiUrl + resource;

    try {
      const response = await fetch(finalResource, options);
      clearTimeout(id);
      return response;
    } catch (error) {
      throw new Error('Request timed out');
    }
  }

```

### 7. 实现重试逻辑
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
          // 根据HTTP状态码来决定是否抛出异常以触发重试
          // 5xx 错误代码进行重试 ， 其他4xx错误，通常不应重试
          if (status >= 500) {
            throw new Error(`Network response was not ok: ${status}`);
          } else if (status === 429) {
            // 请求过于频繁，应根据响应中的重试时间后再重试
            // 获取服务器建议的重试时间 ...
            if (response.headers.has('Retry-After')) {
              // 使用服务器指定的重试时间
              interval = parseInt(response.headers.get('Retry-After')!, 10) * 1000;
            }
            throw new Error(`Rate Limit Exceeded: ${status}`);
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

### 8. 实现 request 方法
我们通过 request 方法来统一处理请求，并根据配置决定是否进行重试：
```js

  async request(resource: string, options: RequestOptions = {}): Promise<Response> {
    const retryOnFail = options._retryOnFail !== undefined ? options._retryOnFail : this.retryOnFail;

    options = await this.applyInterceptors(options, this.requestInterceptors);

    if (!retryOnFail) {
      try {
        const response = await this.fetchWithTimeout(resource, options);
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return await this.applyInterceptors(response, this.responseInterceptors);
      } catch (error) {
        for (const interceptor of this.responseInterceptors) {
          if (interceptor.rejected) {
            try {
              return await interceptor.rejected(error);
            } catch (newError) {
              console.error(newError);
              throw newError;
            }
          }
        }
        throw error;
      }
    }

    try {
      const response = await this.retryFetch(resource, options);
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      return await this.applyInterceptors(response, this.responseInterceptors);
    } catch (error) {
      for (const interceptor of this.responseInterceptors) {
        if (interceptor.rejected) {
          try {
            return await interceptor.rejected(error);
          } catch (newError) {
            console.error(newError);
            throw newError;
          }
        }
      }
      throw error;
    }
  }

```

### 9. 封装 GET 和 POST 方法
最后，我们提供封装好的 GET 和 POST 请求方法：
```js
  async get(resource: string, options: RequestOptions = {}) {
    const defaultOptions = { method: 'GET' };
    options = Object.assign(defaultOptions, options);
    return this.request(resource, options);
  }

  async post(resource: string, body: any, options: RequestOptions = {}) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const defaultOptions = {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
    };
    options = Object.assign(defaultOptions, options);

    if (options.headers) {
      const optionHeaders = options.headers;
      if (optionHeaders instanceof Headers) {
        optionHeaders.forEach((value, key) => {
          addHeader(headers, key, value);
        });
      } else if (Array.isArray(optionHeaders)) {
        optionHeaders.forEach((header) => {
          if (header.length === 2) {
            addHeader(headers, header[0], header[1]);
          }
        });
      } else {
        Object.entries(optionHeaders).forEach(([key, value]) => {
          addHeader(headers, key, value);
        });
      }
    }
    options.headers = headers;
    return this.request(resource, options);
  }


```

## 使用示例
我们可以通过以下代码来创建并使用 FetchWrapper 实例：
```js
import FetchWrapper from './FetchWrapper';

const config = {
  timeout: 10000, // 超时时间
  retries: 5, // 重试次数
  retryInterval: 2000, // 重试间隔
  retryOnFail: true, // 开启错误重试
  baseURL: 'https://api.example.com', // 基础URL
};

const fetchWrapper = new FetchWrapper(config);

// 添加请求拦截器
fetchWrapper.useRequestInterceptor(async (options) => {
  options.headers = {
    ...options.headers,
    Authorization: 'Bearer token',
  };
  return options;
});

// 添加响应拦截器
fetchWrapper.useResponseInterceptor(
  (response) => response,
  (error) => {
    console.error('Response error:', error);
    throw error;
  },
);

// 发送GET请求
fetchWrapper.get('/endpoint')
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));

// 发送POST请求
fetchWrapper.post('/endpoint', { key: 'value' })
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));

```

通过以上步骤，我们完成了对 fetch 的封装，实现了超时、重试、拦截器等高级特性。希望这篇文章能够帮助你更好地理解和使用 fetch。

