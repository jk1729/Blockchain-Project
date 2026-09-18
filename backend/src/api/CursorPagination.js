/**
 * PDSChain Cursor-Based Pagination Utility (Phase 14)
 */

function encodeCursor(data) {
  try {
    return Buffer.from(JSON.stringify(data)).toString('base64');
  } catch (err) {
    return null;
  }
}

function decodeCursor(cursorStr) {
  if (!cursorStr || typeof cursorStr !== 'string') return null;
  try {
    const raw = Buffer.from(cursorStr, 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Paginate an array using offset or index-based cursor.
 * @param {Array} items - Source array of items
 * @param {Object} options - { cursor, limit: 20, maxLimit: 100 }
 */
function paginateArray(items = [], options = {}) {
  const maxLimit = options.maxLimit || 100;
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 20, 1), maxLimit);
  
  let offset = 0;
  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    if (decoded && typeof decoded.offset === 'number') {
      offset = Math.max(0, decoded.offset);
    }
  }

  const total = items.length;
  const sliced = items.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;

  const nextCursor = hasMore ? encodeCursor({ offset: nextOffset }) : null;
  const prevCursor = offset > 0 ? encodeCursor({ offset: Math.max(0, offset - limit) }) : null;

  return {
    items: sliced,
    pageInfo: {
      limit,
      offset,
      total,
      hasMore,
      cursor: options.cursor || null,
      nextCursor,
      prevCursor
    }
  };
}

module.exports = {
  encodeCursor,
  decodeCursor,
  paginateArray
};

