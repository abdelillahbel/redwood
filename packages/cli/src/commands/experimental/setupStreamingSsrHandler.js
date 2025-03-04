import fs from 'fs'
import path from 'path'

import { Listr } from 'listr2'

import { addWebPackages } from '@redwoodjs/cli-helpers'
import { getConfigPath } from '@redwoodjs/project-config'
import { errorTelemetry } from '@redwoodjs/telemetry'

import { getPaths, transformTSToJS, writeFile } from '../../lib'
import c from '../../lib/colors'
import { isTypeScriptProject } from '../../lib/project'

import {
  command,
  description,
  EXPERIMENTAL_TOPIC_ID,
} from './setupStreamingSsr'
import { printTaskEpilogue } from './util'

export const handler = async ({ force, verbose }) => {
  const rwPaths = getPaths()
  const redwoodTomlPath = getConfigPath()
  const configContent = fs.readFileSync(redwoodTomlPath, 'utf-8')
  const ts = isTypeScriptProject()
  const ext = path.extname(rwPaths.web.entryClient || '')

  const tasks = new Listr(
    [
      {
        title: 'Check prerequisites',
        task: () => {
          if (!rwPaths.web.entryClient || !rwPaths.web.viteConfig) {
            throw new Error(
              'Vite needs to be setup before you can enable Streaming SSR'
            )
          }
        },
      },
      {
        title: 'Adding config to redwood.toml...',
        task: (_ctx, task) => {
          if (!configContent.includes('[experimental.streamingSsr]')) {
            writeFile(
              redwoodTomlPath,
              configContent.concat(
                `\n[experimental.streamingSsr]\n  enabled = true\n`
              ),
              {
                overwriteExisting: true, // redwood.toml always exists
              }
            )
          } else {
            if (force) {
              task.output = 'Overwriting config in redwood.toml'

              writeFile(
                redwoodTomlPath,
                configContent.replace(
                  // Enable if it's currently disabled
                  `\n[experimental.streamingSsr]\n  enabled = false\n`,
                  `\n[experimental.streamingSsr]\n  enabled = true\n`
                ),
                {
                  overwriteExisting: true, // redwood.toml always exists
                }
              )
            } else {
              task.skip(
                `The [experimental.streamingSsr] config block already exists in your 'redwood.toml' file.`
              )
            }
          }
        },
        options: { persistentOutput: true },
      },
      {
        title: `Adding entry.client${ext}...`,
        task: async (_ctx, task) => {
          const entryClientTemplate = fs.readFileSync(
            path.resolve(
              __dirname,
              'templates',
              'streamingSsr',
              'entry.client.tsx.template'
            ),
            'utf-8'
          )
          let entryClientPath = rwPaths.web.entryClient
          const entryClientContent = ts
            ? entryClientTemplate
            : transformTSToJS(entryClientPath, entryClientTemplate)

          let overwriteExisting = force

          if (!force) {
            overwriteExisting = await task.prompt({
              type: 'Confirm',
              message: `Overwrite ${entryClientPath}?`,
            })

            if (!overwriteExisting) {
              entryClientPath = entryClientPath.replace(ext, `.new${ext}`)
              task.output =
                `File will be written to ${entryClientPath}\n` +
                `You'll manually need to merge it with your existing entry.client${ext} file.`
            }
          }

          writeFile(entryClientPath, entryClientContent, { overwriteExisting })
        },
        options: { persistentOutput: true },
      },
      {
        title: `Adding entry.server${ext}...`,
        task: async () => {
          const entryServerTemplate = fs.readFileSync(
            path.resolve(
              __dirname,
              'templates',
              'streamingSsr',
              'entry.server.tsx.template'
            ),
            'utf-8'
          )
          // Can't use rwPaths.web.entryServer because it might not be not created yet
          const entryServerPath = path.join(
            rwPaths.web.src,
            `entry.server${ext}`
          )
          const entryServerContent = ts
            ? entryServerTemplate
            : transformTSToJS(entryServerPath, entryServerTemplate)

          writeFile(entryServerPath, entryServerContent, {
            overwriteExisting: force,
          })
        },
      },
      {
        title: `Adding Document${ext}...`,
        task: async () => {
          const documentTemplate = fs.readFileSync(
            path.resolve(
              __dirname,
              'templates',
              'streamingSsr',
              'Document.tsx.template'
            ),
            'utf-8'
          )
          const documentPath = path.join(rwPaths.web.src, `Document${ext}`)
          const documentContent = ts
            ? documentTemplate
            : transformTSToJS(documentPath, documentTemplate)

          writeFile(documentPath, documentContent, {
            overwriteExisting: force,
          })
        },
      },
      addWebPackages([
        '@apollo/experimental-nextjs-app-support@0.0.0-commit-b8a73fe',
      ]),
      {
        task: () => {
          printTaskEpilogue(command, description, EXPERIMENTAL_TOPIC_ID)
        },
      },
    ],
    {
      rendererOptions: { collapseSubtasks: false, persistentOutput: true },
      renderer: verbose ? 'verbose' : 'default',
    }
  )

  try {
    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
