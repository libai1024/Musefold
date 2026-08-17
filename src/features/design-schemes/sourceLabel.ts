/** 从 GitHub 地址提取 owner/repo 展示标签；解析失败时原样返回。 */
export function repositoryLabel(url: string): string {
  const match = url.match(/github\.com\/([^/]+\/[^/#?]+)/i);
  return (match?.[1] ?? url).replace(/\.git$/, '');
}
