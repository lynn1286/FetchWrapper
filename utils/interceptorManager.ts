interface Interceptor<T, O = any> {
  fulfilled?: (value: T, options?: O) => T | Promise<T>
  rejected?: (error: any, options?: O) => any
}

class InterceptorManager<T, O = any> {
  private handlers: Array<Interceptor<T, O>> = []

  use(fulfilled?: Interceptor<T, O>['fulfilled'], rejected?: Interceptor<T, O>['rejected']): void {
    this.handlers.push({
      fulfilled,
      rejected
    })
  }

  async runHandlers(value: T, options?: O): Promise<T> {
    for (const { fulfilled, rejected } of this.handlers) {
      try {
        if (fulfilled) {
          value = await fulfilled(value, options)
        }
      } catch (error) {
        if (rejected) {
          await rejected(error, options)
        }
        throw error
      }
    }
    return value
  }
}

export default InterceptorManager
