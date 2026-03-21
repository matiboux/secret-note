export function sizeToString(size: number)
{
	if (size < 1024)
	{
		return `${size} B`
	}

	if (size < 1048576) // 1024 * 1024
	{
		return `${(size / 1024).toFixed(2)} KiB`
	}

	if (size < 1073741824) // 1024 * 1024 * 1024
	{
		return `${(size / 1048576).toFixed(2)} MiB`
	}

	if (size < 1099511627776) // 1024 * 1024 * 1024 * 1024
	{
		return `${(size / 1073741824).toFixed(2)} GiB`
	}

	return `${(size / 1099511627776).toFixed(2)} TiB`
}
