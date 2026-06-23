-- Lua usage examples. In the consuming resource's fxmanifest.lua add:
--   shared_script '@vSQL/lib/MySQL.lua'
--   dependency 'vSQL'

-- 1) Load a player on join, with named parameters and a synchronous await.
RegisterNetEvent('app:playerJoined', function(citizenid)
  local player = MySQL.single.await('SELECT * FROM players WHERE citizenid = @id', { id = citizenid })
  if not player then
    MySQL.insert.await('INSERT INTO players (citizenid, license, name) VALUES (?, ?, ?)', {
      citizenid, 'license:unknown', GetPlayerName(source)
    })
    print(('created new player %s'):format(citizenid))
  else
    print(('welcome back %s ($%d)'):format(player.name, player.money))
  end
end)

-- 2) Callback style (non-blocking) — useful when you don't want to yield.
RegisterCommand('mymoney', function(source)
  MySQL.scalar('SELECT bank FROM players WHERE citizenid = ?', { GetPlayerIdentifier(source, 0) }, function(bank)
    TriggerClientEvent('chat:addMessage', source, { args = { 'Bank', ('$%d'):format(bank or 0) } })
  end)
end, false)

-- 3) Atomic money transfer in a transaction — either both rows update or neither.
local function transfer(fromId, toId, amount)
  return MySQL.transaction.await({
    { 'UPDATE players SET bank = bank - ? WHERE citizenid = ? AND bank >= ?', { amount, fromId, amount } },
    { 'UPDATE players SET bank = bank + ? WHERE citizenid = ?', { amount, toId } }
  })
end
