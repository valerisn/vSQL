fx_version 'cerulean'
game 'common'

name 'vSQL'
author 'vSQL contributors'
description 'High-performance MySQL/MariaDB database resource for FiveM'
version '1.0.0'

server_script 'dist/index.js'

-- `shared_script '@vSQL/lib/MySQL.lua'` to their own fxmanifest.
files {
  'lib/MySQL.lua'
}

dependencies {
  '/server:7290'
}
