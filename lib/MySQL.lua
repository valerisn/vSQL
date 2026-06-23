-- Optional convenience wrapper that mirrors oxmysql's `MySQL` global so existing
-- Lua code migrates with minimal changes. Load it from a consumer resource with:
--   shared_script '@vSQL/lib/MySQL.lua'
--
-- Every method has a `.await` form for synchronous use inside a thread, and a
-- callback form (pass a function as the last argument).

local vSQL = exports.vSQL

-- Turns a promise-returning export into a callable that supports both a trailing
-- callback and a `.await` field. The await path bridges through a callback so it
-- works regardless of how FXServer marshals JS promises into Lua.
local function makeFn(method)
  local fn = function(query, params, cb)
    if type(params) == 'function' then
      cb = params
      params = nil
    end
    return vSQL[method](vSQL, query, params, cb)
  end

  return setmetatable({
    await = function(query, params)
      local p = promise.new()
      vSQL[method](vSQL, query, params, function(result)
        p:resolve(result)
      end)
      return Citizen.Await(p)
    end
  }, { __call = function(_, ...) return fn(...) end })
end

MySQL = {
  query = makeFn('query'),
  execute = makeFn('execute'),
  single = makeFn('single'),
  scalar = makeFn('scalar'),
  insert = makeFn('insert'),
  update = makeFn('update'),
  prepare = makeFn('prepare')
}

MySQL.batch = setmetatable({
  await = function(query, rows)
    local p = promise.new()
    vSQL:batch(query, rows, function(result) p:resolve(result) end)
    return Citizen.Await(p)
  end
}, { __call = function(_, query, rows, cb) return vSQL:batch(query, rows, cb) end })

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
  execute = MySQL.update.await
}

MySQL.Async = {
  fetchAll = MySQL.query,
  fetchScalar = MySQL.scalar,
  fetchSingle = MySQL.single,
  insert = MySQL.insert,
  execute = MySQL.update
}

return MySQL
