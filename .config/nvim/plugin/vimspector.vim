" Maintainer: Eike Lurz <moin@elurz.de>

" puremourning/vimspector

if exists('g:plugs["vimspector"]')

nnoremap <Space>da :call vimspector#Launch()<CR>
nnoremap <Space>dx :call vimspector#Reste()<CR>
nnoremap <S-k> :call vimspector#StepOut()<CR>
nnoremap <S-l> :call vimspector#StepInto()<CR>
nnoremap <S-j> :call vimspector#StepOver()<CR>
nnoremap <Space>d_ :call vimspector#Restart()<CR>
nnoremap <Space>dn :call vimspector#Continue()<CR>
nnoremap <Space>drc :call vimspector#RunToCursor()<CR>
nnoremap <Space>dh :call vimspector#ToggleBreakpoint()<CR>
nnoremap <Space>de :call vimspector#ToggleConditionalBreakpoint()<CR>
nnoremap <Space>dX :call vimspector#ClearBrealpoints()<CR>
nnoremap <Space>d? :call AddToWatch()<CR>

func! AddToWatch()
  let word = expand("<cexpr>")
  call vimspector#AddWatch(word)
endfunction
let g:vimspector_base_dir = expand('$HOME/.config/vimspector-config')

endif
