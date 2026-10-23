import { upstreamAlphaModules } from './module-sync.js';

/** Read the alpha package folders aws/aws-cdk ships at one release tag. */
export async function fetchUpstreamAlphaModules(
  coreVersion: string,
  token: string | undefined = process.env.GH_TOKEN,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const url = `https://api.github.com/repos/aws/aws-cdk/contents/packages/@aws-cdk?ref=v${coreVersion}`;
  const headers: Record<string, string> = {
    'accept': 'application/vnd.github+json',
    'user-agent': 'cdk-docs-alpha-modules',
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetcher(url, { headers });
  if (!response.ok) {
    throw new Error(`GET ${url}: HTTP ${response.status}`);
  }
  return upstreamAlphaModules(await response.json());
}
