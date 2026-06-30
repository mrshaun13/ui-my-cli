/**
 * Provider registry for local headless-agent adapters.
 */

const codex = require('./codex');
const devin = require('./devin');

const providers = new Map([
  [codex.id, codex],
  [devin.id, devin],
]);

const DEFAULT_PROVIDER_ID = process.env.UI_MY_CLI_DEFAULT_PROVIDER || 'codex';

function getProvider(id = DEFAULT_PROVIDER_ID) {
  const provider = providers.get(id);
  if (!provider) {
    const valid = [...providers.keys()].join(', ');
    throw new Error(`Unknown provider "${id}". Valid providers: ${valid}`);
  }
  return provider;
}

function listProviders() {
  return [...providers.values()].map(provider => {
    const status = provider.availability ? provider.availability() : { available: true };
    return {
      id: provider.id,
      label: provider.label,
      noun: provider.noun,
      dashboardTitle: provider.dashboardTitle,
      command: provider.command,
      accent: provider.accent,
      storagePrefix: provider.storagePrefix,
      ...status,
    };
  });
}

function safeListProviders() {
  return [...providers.values()].map(provider => {
    try {
      const status = provider.availability ? provider.availability() : { available: true };
      return {
        id: provider.id,
        label: provider.label,
        noun: provider.noun,
        dashboardTitle: provider.dashboardTitle,
        command: provider.command,
        accent: provider.accent,
        storagePrefix: provider.storagePrefix,
        ...status,
      };
    } catch (err) {
      return {
        id: provider.id,
        label: provider.label,
        noun: provider.noun,
        dashboardTitle: provider.dashboardTitle,
        command: provider.command,
        accent: provider.accent,
        storagePrefix: provider.storagePrefix,
        available: false,
        error: err.message,
      };
    }
  });
}

module.exports = {
  DEFAULT_PROVIDER_ID,
  getProvider,
  listProviders,
  safeListProviders,
  providers,
};
