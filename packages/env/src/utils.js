import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

const GIT_COMMIT_FORMAT = [
  'COMMIT_SHA:%H',
  'AUTHOR_NAME:%an',
  'AUTHOR_EMAIL:%ae',
  'COMMITTER_NAME:%cn',
  'COMMITTER_EMAIL:%ce',
  'COMMITTED_DATE:%ai',
  // order is important, this must come last because the regex is a multiline match.
  'COMMIT_MESSAGE:%B'
].join('%n'); // git show format uses %n for newlines.

export function git(args) {
  try {
    return execSync(`git ${args}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8'
    });
  } catch (e) {
    return '';
  }
}

// get raw commit data
export function getCommitData(sha, branch, vars = {}) {
  let raw = git(`show ${sha || 'HEAD'} --quiet --format=${GIT_COMMIT_FORMAT}`);

  // prioritize PERCY_GIT_* vars and fallback to GIT_* vars
  let get = key => vars[`PERCY_GIT_${key}`] ||
    raw.match(new RegExp(`${key}:(.*)`, 'm'))?.[1] ||
    vars[`GIT_${key}`] || null;

  return {
    sha: sha?.length === 40 ? sha : get('COMMIT_SHA'),
    branch: branch || git('rev-parse --abbrev-ref HEAD') || null,
    message: get('COMMIT_MESSAGE'),
    authorName: get('AUTHOR_NAME'),
    authorEmail: get('AUTHOR_EMAIL'),
    committedAt: get('COMMITTED_DATE'),
    committerName: get('COMMITTER_NAME'),
    committerEmail: get('COMMITTER_EMAIL')
  };
}

// the sha needed from Jenkins merge commits is the parent sha
export function getJenkinsSha() {
  let data = getCommitData();

  return data.authorName === 'Jenkins' &&
    data.authorEmail === 'nobody@nowhere' &&
    data.message.match(/^Merge commit [^\s]+ into HEAD$/) &&
    git('rev-parse HEAD^');
}

// github actions are triggered by webhook events which are saved to the filesystem
export function github({ GITHUB_EVENT_PATH }) {
  if (!github.payload && GITHUB_EVENT_PATH && existsSync(GITHUB_EVENT_PATH)) {
    try { github.payload = JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8')); } catch (e) {}
  }

  return (github.payload ||= {});
}
