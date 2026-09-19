const fs = require('fs');
const os = require('os');
const path = require('path');

describe('EventStore journal path configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdschain-eventstore-config-'));
  const journalPath = path.join(root, 'events.jsonl');

  beforeAll(() => {
    process.env.EVENTS_JOURNAL_PATH = journalPath;
  });

  test('uses the configured journal path for the default event store', async () => {
    jest.resetModules();
    const { defaultEventStore } = require('../src/controllers/eventController');
    expect(defaultEventStore.filepath).toBe(path.resolve(journalPath));
    expect(defaultEventStore.filepath.startsWith(path.resolve(process.cwd()))).toBe(false);
  });
});
