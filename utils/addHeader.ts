// 辅助函数：安全地向Headers对象添加键值对
function addHeader(headers: Headers, key: string, value: any) {
  if (typeof value === 'string') {
    // 只有在值是字符串类型时才添加该header
    headers.set(key, value)
  } else {
    console.warn(`Attempting to set header with non-string value. Key: ${key}, Value: ${value}`)
  }
}

export default addHeader
