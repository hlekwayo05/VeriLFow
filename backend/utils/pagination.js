'use strict';

/**
 * Optional page/limit query parsing.
 * When neither page nor limit is provided, pagination is disabled (legacy array responses).
 */
function parsePagination(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const rawPage = parseInt(query.page, 10);
  const rawLimit = parseInt(query.limit, 10);
  const enabled = Number.isFinite(rawPage) || Number.isFinite(rawLimit);
  if (!enabled) {
    return { enabled: false, page: 1, limit: defaultLimit, offset: 0 };
  }

  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.isFinite(rawLimit) ? rawLimit : defaultLimit)
  );
  return { enabled: true, page, limit, offset: (page - 1) * limit };
}

function sendList(res, rows, pagination, total) {
  if (!pagination.enabled) {
    return res.status(200).json(rows);
  }
  const totalCount = Number(total) || 0;
  return res.status(200).json({
    data: rows,
    page: pagination.page,
    limit: pagination.limit,
    total: totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    hasMore: pagination.page * pagination.limit < totalCount,
  });
}

module.exports = { parsePagination, sendList };
