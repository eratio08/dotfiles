;; extends

; sql
; a general query injection
([
  (quoted_content)
  ] @injection.content
 (#match? @injection.content "(SELECT|INSERT|UPDATE|DELETE|ALTER|GRANT|CREATE|DROP|ANALYZE|VACUUM|COPY|REINDEX|COMMENT).+(FROM|INTO|VALUES|SET|SCHEMA|TABLE|ON|VERBOSE|ANALYZE|FULL|setval|TO|INDEX|SEQUENCE|VIEW).*(WHERE|GROUP BY|LIMIT|OFFSET)?")
(#set! injection.language "sql"))

; fallback comment based injection
([
  (quoted_content)
 ] @injection.content
 (#contains? @injection.content "//sql")
 (#set! injection.language "sql"))

; html
; a general query injection
([
  (quoted_content)
  ] @injection.content
 (#match? @injection.content "(<!DOCTYPE html>|<html|<head|<body|<div|<form|<h[1-6]|<p|<a).*")
(#set! injection.language "html"))
