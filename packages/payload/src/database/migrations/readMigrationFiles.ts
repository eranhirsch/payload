import fs from 'fs'
import path from 'path'

import type { Payload } from '../../index.d.ts'
import type { Migration } from '../types.d.ts'

/**
 * Read the migration files from disk
 */
export const readMigrationFiles = async ({
  payload,
}: {
  payload: Payload
}): Promise<Migration[]> => {
  if (!fs.existsSync(payload.db.migrationDir)) {
    payload.logger.error({
      msg: `No migration directory found at ${payload.db.migrationDir}`,
    })
    return []
  }

  payload.logger.info({
    msg: `Reading migration files from ${payload.db.migrationDir}`,
  })

  const files = fs
    .readdirSync(payload.db.migrationDir)
    .sort()
    .filter((f) => {
      return f.endsWith('.ts') || f.endsWith('.js')
    })
    .map((file) => {
      return path.resolve(payload.db.migrationDir, file)
    })

  return Promise.all(
    files.map(async (filePath) => {
      // eval used to circumvent errors bundling
      const migration = eval(`require('${filePath.replaceAll('\\', '/')}')`)
      migration.name = path.basename(filePath).split('.')?.[0]
      return migration
    }),
  )
}
