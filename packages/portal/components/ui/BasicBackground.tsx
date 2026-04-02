'use client'

interface Props {
  backgroundColor?: string
}

export function BasicBackground({ backgroundColor = '#0d1218' }: Props) {
  return (
    <div
      className="absolute inset-0"
      style={{ backgroundColor }}
    />
  )
}
