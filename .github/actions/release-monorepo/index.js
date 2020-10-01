const core = require('@actions/core')
const github = require('@actions/github')
const { exec } = require('@actions/exec')

const fs = require('fs')
const EVENT = 'pull_request'

const githubToken = core.getInput('github-token')
const actor = process.env.GITHUB_ACTOR
const repository = process.env.GITHUB_REPOSITORY
const remote = `https://${actor}:${githubToken}@github.com/${repository}.git`

const octokit = new github.getOctokit(githubToken)

const getBaseVersions = async (base, initial = '0.0.0') => {
  const { context } = github

  const packagesPath = './packages'
  const packagesNames = fs.readdirSync(packagesPath)

  return packagesNames.reduce(async (packageJsons, packageName) => {
    const packagePath = `${packagesPath}/${packageName}`
    if (!fs.statSync(packagePath).isDirectory) return

    try {
      const pkgFile = await octokit.repos.getContents({
        ...context.repo,
        ref: base,
        path: `${packagePath}/package.json`,
      })

      const content = Buffer.from(pkgFile.data.content, 'base64')

      const { version } = JSON.parse(content)
      return {
        ...packageJsons,
        [packageName]: version,
      }
    } catch (e) {
      return packageJsons
    }
  }, {})
}

const forceBaseVersions = baseVersions => {
  Object.entries(baseVersions).forEach(([packageName, version]) => {
    const path = `./packages/${packageName}/package.json`
    const headPackage = JSON.parse(fs.readFileSync(path))
    headPackage.version = version
    const forcedBasePackage = JSON.stringify(headPackage)
    fs.unlinkSync(path)
    fs.writeFileSync(path, forcedBasePackage)
  })
}

const bump = async () => {
  await exec(
    `npx lerna version --conventional-commits --create-release github --no-push --yes`,
  )
}

const configGit = async head => {
  await exec(`git fetch ${remote} ${head}:${head}`)
  await exec(`git config --local user.email "action@github.com"`)
  await exec(`git config --local user.name "Version Bump Action"`)
  await exec(`git checkout ${head}`)
}

const pushBumpedVersionAndTag = async head => {
  await exec(`git push "${remote}" HEAD:${head}`)
  await exec(`git push -f --tags`)
}

const run = async () => {
  const base = core.getInput('base-branch')
  const head = core.getInput('head-branch')
  const initialVersion = core.getInput('initial-version')

  try {
    await configGit(head)
    const baseVersions = await getBaseVersions(base, initialVersion)
    forceBaseVersions(baseVersions)
    await bump()
    console.log(`bumped packages!`)
    await pushBumpedVersionAndTag(head)
    console.log(`release pushed!`)
  } catch (e) {
    core.setFailed(e)
  }
}

run()
