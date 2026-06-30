-- Optional convenience wrapper that mirrors oxmysql's `MySQL` global so existing
-- Lua code migrates with minimal changes. Load it from a consumer resource with:
--   shared_script '@vSQL/lib/MySQL.lua'
--
-- Every method has a `.await` form for synchronous use inside a thread, and a
-- callback form (pass a function as the last argument). Any export not listed
-- here is forwarded to exports.vSQL automatically (callback style).

local vSQL = exports.vSQL

-- A query may be a stored handle (a number returned by MySQL.store) instead of a
-- SQL string; resolve it before every call, like oxmysql.
local queryStore = {}

local function resolveQuery(query)
  if type(query) == 'number' then
    return assert(queryStore[query], 'invalid query store reference')
  end
  return query
end

local function isCallback(v)
  return type(v) == 'function' or (type(v) == 'table' and v.__cfx_functionReference ~= nil)
end

-- Turns a promise-returning export into a callable that supports both a trailing
-- callback and a `.await` field. The await path bridges through a callback so it
-- works regardless of how FXServer marshals JS promises into Lua.
local function makeFn(method)
  local fn = function(query, params, cb)
    if isCallback(params) then
      cb = params
      params = nil
    end
    return vSQL[method](vSQL, resolveQuery(query), params, cb)
  end

  return setmetatable({
    await = function(query, params)
      local p = promise.new()
      vSQL[method](vSQL, resolveQuery(query), params, function(result)
        p:resolve(result)
      end)
      return Citizen.Await(p)
    end
  }, { __call = function(_, ...) return fn(...) end })
end

-- store: register a SQL string, returning a numeric handle reusable as the query
-- argument to any method (so a long statement isn't re-marshalled every call).
local function addStore(query, cb)
  assert(type(query) == 'string', 'store expects a SQL string')
  local n = #queryStore + 1
  queryStore[n] = query
  if cb then return cb(n) end
  return n
end

local methods = {
  query = makeFn('query'),
  execute = makeFn('execute'),
  single = makeFn('single'),
  scalar = makeFn('scalar'),
  insert = makeFn('insert'),
  update = makeFn('update'),
  prepare = makeFn('prepare'),
  rawExecute = makeFn('rawExecute'),
  store = addStore
}

-- Forward any other MySQL.x to the matching vSQL export (callback style), so new
-- exports - find, insertInto, tableExists, etc. - are reachable without edits.
MySQL = setmetatable(methods, {
  __index = function(_, index)
    return function(...)
      return vSQL[index](vSQL, ...)
    end
  end
})

MySQL.batch = setmetatable({
  await = function(query, rows)
    local p = promise.new()
    vSQL:batch(resolveQuery(query), rows, function(result) p:resolve(result) end)
    return Citizen.Await(p)
  end
}, { __call = function(_, query, rows, cb) return vSQL:batch(resolveQuery(query), rows, cb) end })

MySQL.transaction = setmetatable({
  await = function(queries)
    local p = promise.new()
    vSQL:transaction(queries, function(result) p:resolve(result) end)
    return Citizen.Await(p)
  end
}, { __call = function(_, queries, cb) return vSQL:transaction(queries, cb) end })

function MySQL.ready(cb)
  if cb then return vSQL:ready(cb) end
  local p = promise.new()
  vSQL:ready(function() p:resolve(true) end)
  return Citizen.Await(p)
end

-- Legacy oxmysql aliases (older codebases use Sync/Async naming).
MySQL.Sync = {
  fetchAll = MySQL.query.await,
  fetchScalar = MySQL.scalar.await,
  fetchSingle = MySQL.single.await,
  insert = MySQL.insert.await,
  execute = MySQL.update.await,
  prepare = MySQL.prepare.await,
  transaction = MySQL.transaction.await,
  store = addStore
}

MySQL.Async = {
  fetchAll = MySQL.query,
  fetchScalar = MySQL.scalar,
  fetchSingle = MySQL.single,
  insert = MySQL.insert,
  execute = MySQL.update,
  prepare = MySQL.prepare,
  transaction = MySQL.transaction,
  store = addStore
}

return MySQL
