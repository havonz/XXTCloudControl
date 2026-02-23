#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_REPOSITORY = 'havonz/XXTCloudControl';
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 40;

const REQUIRED_ASSET_MATCHERS = [
  {
    label: 'update-manifest.json',
    match: (name) => name === 'update-manifest.json'
  },
  {
    label: 'XXTCloudControl-v*-darwin-arm64.zip',
    match: (name) => /^XXTCloudControl-v.+-darwin-arm64\.zip$/.test(name)
  },
  {
    label: 'XXTCloudControl-v*-darwin-amd64.zip',
    match: (name) => /^XXTCloudControl-v.+-darwin-amd64\.zip$/.test(name)
  },
  {
    label: 'XXTCloudControl-v*-windows-amd64.zip',
    match: (name) => /^XXTCloudControl-v.+-windows-amd64\.zip$/.test(name)
  },
  {
    label: 'XXTCloudControl-v*-windows-arm64.zip',
    match: (name) => /^XXTCloudControl-v.+-windows-arm64\.zip$/.test(name)
  },
  {
    label: 'XXTCloudControl-v*-linux-amd64.zip',
    match: (name) => /^XXTCloudControl-v.+-linux-amd64\.zip$/.test(name)
  },
  {
    label: 'XXTCloudControl-v*-linux-arm64.zip',
    match: (name) => /^XXTCloudControl-v.+-linux-arm64\.zip$/.test(name)
  }
];

const TARGET_PLATFORMS = [
  { os: 'darwin', arch: 'arm64', platform: 'macOS (Apple Silicon)' },
  { os: 'darwin', arch: 'amd64', platform: 'macOS (Intel)' },
  { os: 'windows', arch: 'amd64', platform: 'Windows x64' },
  { os: 'windows', arch: 'arm64', platform: 'Windows ARM64' },
  { os: 'linux', arch: 'amd64', platform: 'Linux AMD64' },
  { os: 'linux', arch: 'arm64', platform: 'Linux ARM64' }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getRepository() {
  const repository = process.env.RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${repository}`);
  }
  return { repository, owner, repo };
}

async function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return null;
  }

  try {
    const raw = await readFile(eventPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getTargetTag(eventPayload) {
  if (process.env.RELEASE_TAG) {
    return process.env.RELEASE_TAG;
  }

  if (eventPayload?.client_payload?.release_tag) {
    return eventPayload.client_payload.release_tag;
  }

  if (eventPayload?.release?.tag_name) {
    return eventPayload.release.tag_name;
  }

  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }

  return '';
}

function createHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'xxtcloudcontrol-release-pages-builder'
  };

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchJSON(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${message.slice(0, 240)}`);
  }
  return response.json();
}

async function fetchText(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${message.slice(0, 240)}`);
  }
  return response.text();
}

async function fetchRelease(headers, repository, tag) {
  const endpoint = tag
    ? `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`
    : `https://api.github.com/repos/${repository}/releases/latest`;

  return fetchJSON(endpoint, headers);
}

function listMissingRequiredAssets(assets) {
  const names = assets.map((asset) => asset.name || '');
  return REQUIRED_ASSET_MATCHERS.filter((matcher) => !names.some((name) => matcher.match(name))).map(
    (matcher) => matcher.label
  );
}

function parseLatestTxtVersion(content) {
  const text = content.trim();
  if (!text) {
    return '';
  }

  const lines = text.split(/\r?\n/);
  const versionLine = lines.find((line) => line.startsWith('version='));
  if (versionLine) {
    return versionLine.slice('version='.length).trim();
  }

  if (!text.includes('=')) {
    return text;
  }

  return '';
}

function assertVersionAligned(manifestVersion, releaseTag, latestTxtVersion) {
  if (manifestVersion && releaseTag && manifestVersion !== releaseTag) {
    throw new Error(`Manifest version (${manifestVersion}) does not match release tag (${releaseTag}).`);
  }

  if (manifestVersion && latestTxtVersion && manifestVersion !== latestTxtVersion) {
    throw new Error(`Manifest version (${manifestVersion}) does not match latest.txt (${latestTxtVersion}).`);
  }
}

function selectPlatformAssets(manifestAssets, releaseAssetMap) {
  return TARGET_PLATFORMS.map((target) => {
    const asset = manifestAssets.find((item) => item.os === target.os && item.arch === target.arch);
    if (!asset) {
      throw new Error(`Missing manifest asset for platform: ${target.platform} (${target.os}/${target.arch})`);
    }

    const releaseAsset = releaseAssetMap.get(asset.name);
    if (!releaseAsset) {
      throw new Error(`Release asset metadata missing for file: ${asset.name}`);
    }

    return {
      platform: target.platform,
      name: asset.name,
      downloadUrl: asset.latestUrl || asset.url || releaseAsset.browser_download_url,
      sizeBytes: releaseAsset.size,
      sha256: asset.sha256 || ''
    };
  });
}

function buildOutput(release, manifest, assets, repository) {
  const version = manifest.version || release.tag_name || '';
  return {
    version,
    publishedAt: release.published_at || manifest.publishedAt || new Date().toISOString(),
    releaseUrl: release.html_url || `https://github.com/${repository}/releases/tag/${version}`,
    historyUrl: `https://github.com/${repository}/releases`,
    checksumsUrl: manifest.checksumsUrl || '',
    assets,
    channel: manifest.channel || 'stable',
    buildTime: manifest.buildTime || '',
    commit: manifest.commit || ''
  };
}

async function main() {
  const { repository } = getRepository();
  const headers = createHeaders();
  const eventPayload = await readEventPayload();
  const targetTag = getTargetTag(eventPayload);

  let release = null;
  let missing = [];

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    release = await fetchRelease(headers, repository, targetTag);
    missing = listMissingRequiredAssets(release.assets || []);

    if (missing.length === 0) {
      break;
    }

    if (attempt === MAX_POLL_ATTEMPTS) {
      throw new Error(
        `Release assets were not ready after ${MAX_POLL_ATTEMPTS} attempts: ${missing.join(', ')}`
      );
    }

    console.log(
      `[wait ${attempt}/${MAX_POLL_ATTEMPTS}] release ${release.tag_name} missing: ${missing.join(', ')}`
    );
    await sleep(POLL_INTERVAL_MS);
  }

  const releaseAssets = release.assets || [];
  const manifestAsset = releaseAssets.find((asset) => asset.name === 'update-manifest.json');
  if (!manifestAsset) {
    throw new Error('update-manifest.json not found in release assets.');
  }

  const latestTxtAsset = releaseAssets.find((asset) => asset.name === 'latest.txt');
  const manifestText = await fetchText(manifestAsset.browser_download_url, headers);
  const manifest = JSON.parse(manifestText);

  let latestTxtVersion = '';
  if (latestTxtAsset) {
    const latestTxt = await fetchText(latestTxtAsset.browser_download_url, headers);
    latestTxtVersion = parseLatestTxtVersion(latestTxt);
  }

  assertVersionAligned(manifest.version, release.tag_name, latestTxtVersion);

  const releaseAssetMap = new Map(releaseAssets.map((asset) => [asset.name, asset]));
  const assets = selectPlatformAssets(manifest.assets || [], releaseAssetMap);
  const output = buildOutput(release, manifest, assets, repository);

  const outputPath = path.resolve(process.cwd(), 'src/generated/latest-release.json');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Generated ${outputPath}`);
  console.log(`Version: ${output.version}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
