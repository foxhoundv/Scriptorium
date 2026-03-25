const fs = require('fs-extra');
const path = require('path');

const DEFAULTS = {
  ssoEnabled:      false,
  setupMode:       false,   // true briefly during first-time admin sign-in
  adminUserId:     null,
  requireApproval: true     // admin must approve each new Google user
};

function configPath() {
  return path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'config.json');
}

async function getConfig() {
  try {
    const cfg = await fs.readJson(configPath());
    return { ...DEFAULTS, ...cfg };
  } catch {
    return { ...DEFAULTS };
  }
}

async function saveConfig(updates) {
  const current = await getConfig();
  const updated  = { ...current, ...updates };
  await fs.outputJson(configPath(), updated, { spaces: 2 });
  return updated;
}

module.exports = { getConfig, saveConfig };
