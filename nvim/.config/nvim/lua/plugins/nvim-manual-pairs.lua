return {
  enabled = false,
  'https://git.sr.ht/~xigoi/nvim-manual-pairs',
  event = 'VeryLazy',
  config = function ()
    local manual_pairs = require 'manual-pairs'
    manual_pairs.map_pair('<a-(>', '(', ')')
    manual_pairs.map_pair('<a-[>', '[', ']')
    manual_pairs.map_pair('<a-{>', '{', '}')
    manual_pairs.map_pair('<a-s-,>', '<', '>')
    manual_pairs.map_pair("<a-'>", "'", "'")
    manual_pairs.map_pair('<a-\">', '"', '"')
    manual_pairs.map_pair('<a-`>', '`', '`')
  end,
}
