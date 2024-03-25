// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validatePluginJson = (pluginJson: any) => {
  if (!pluginJson.id) {
    throw new Error('Plugin id is missing in plugin.json')
  }

  if (!pluginJson.info) {
    throw new Error('Plugin info node is missing in plugin.json')
  }

  if (!pluginJson.info.version) {
    throw new Error('Plugin info.version is missing in plugin.json')
  }

  const types = ['panel', 'datasource', 'app']
  const type = pluginJson.type
  if (!types.includes(type)) {
    throw new Error('Invalid plugin type in plugin.json: ' + type)
  }

  if (!pluginJson.id.endsWith('-' + type)) {
    throw new Error('[plugin.json] id should end with: -' + type)
  }
}

export const getPluginJson = (path: string) => {
  let pluginJson
  try {
    pluginJson = require(path)
  } catch (e) {
    throw new Error('Unable to find: ' + path)
  }

  validatePluginJson(pluginJson)

  return pluginJson
}

export const assertRootUrlIsValid = (rootUrl: string) => {
  try {
    new URL(rootUrl)
  } catch (err) {
    throw new Error(`${rootUrl} is not a valid URL`)
  }
}