export async function readFileData(
	file: File | null | undefined
): Promise<Uint8Array<ArrayBufferLike> | null>
{
	if (!file)
	{
		return null
	}

	return new Promise((resolve, reject) =>
	{
		const reader = new FileReader()

		reader.onload = async (event) =>
		{
			const result = event.target?.result
			if (typeof result === 'string')
			{
				const encoder = new TextEncoder()
				resolve(encoder.encode(result))
			}
			else if (result instanceof ArrayBuffer)
			{
				resolve(new Uint8Array(result))
			}
			else
			{
				reject(new Error('Unsupported file type.'))
			}
		}
		reader.onerror = (error) =>
		{
			reject(error)
		}
		reader.readAsArrayBuffer(file)
	})
}
