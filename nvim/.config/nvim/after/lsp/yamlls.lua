return {
  settings = {
    redhat = { telemetry = { enabled = false } },
    yaml = {
      validate = true,
      schemaStore = {
        enable = false,
        url = '',
      },
      schemas = require('schemastore').yaml.schemas({
        extra = { {
          description = 'DSOMM Schema',
          fileMatch = 'generated.yaml',
          name = 'generated.yaml',
          url = 'schema/dsomm-schema.json',
        } }
      }),
    },
  },
}
