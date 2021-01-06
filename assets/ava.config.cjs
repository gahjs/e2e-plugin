module.exports = {
  nonSemVerExperiments: {
		configurableModuleFormat: true
  },
  extensions: {
		ts: 'commonjs'
  },
  environmentVariables:{
    'TS_NODE_PROJECT': 'tsconfig.spec.json'
  },
  require: [
    'ts-node/register',
    'tsconfig-paths/register'
  ],
  timeout: '2m'
};
