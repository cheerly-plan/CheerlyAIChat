import logo from '../../assets/logo.png'

type Props = {
  size?: number
}

export function Logo({ size = 32 }: Props) {
  return (
    <img
      src={logo}
      alt="Cheerly"
      className="logo"
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  )
}
