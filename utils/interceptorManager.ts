interface Interceptor<T> {
  fulfilled?: (value: T) => T | Promise<T>
  rejected?: (error: any) => any
}

class InterceptorManager<T> {
  private handlers: Array<Interceptor<T>> = []

  use(fulfilled?: Interceptor<T>['fulfilled'], rejected?: Interceptor<T>['rejected']): void {
    this.handlers.push({
      fulfilled,
      rejected
    })
  }

  async runHandlers(value: T): Promise<T> {
    for (const { fulfilled, rejected } of this.handlers) {
      try {
        if (fulfilled) {
          value = await fulfilled(value)
        }
      } catch (error) {
        if (rejected) {
          await rejected(error)
        }
        throw error
      }
    }
    return value
  }
}

export default InterceptorManager
