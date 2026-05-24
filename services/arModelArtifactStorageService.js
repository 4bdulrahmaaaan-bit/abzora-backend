const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AR_MODEL_DIR = path.join(__dirname, '..', 'storage', 'ar-models');
const AR_DATASET_DIR = path.join(__dirname, '..', 'storage', 'ar-datasets');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function checksumOfBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function writeArtifact({ modelVersion, artifactType, payload }) {
  ensureDir(AR_MODEL_DIR);
  const modelDir = path.join(AR_MODEL_DIR, modelVersion);
  ensureDir(modelDir);
  const filename = `${artifactType}.json`;
  const filePath = path.join(modelDir, filename);
  const serialized = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(filePath, serialized);
  return {
    uri: `/files/ar-models/${modelVersion}/${filename}`,
    bytes: serialized.length,
    checksum: checksumOfBuffer(serialized),
    filePath,
  };
}

function loadDataset(datasetVersion) {
  ensureDir(AR_DATASET_DIR);
  const filePath = path.join(AR_DATASET_DIR, `${datasetVersion}.json`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

module.exports = {
  AR_MODEL_DIR,
  AR_DATASET_DIR,
  writeArtifact,
  loadDataset,
};
