import { useEffect, useState } from 'react';

export function useBlobUrl(blob?: Blob | null) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) {
      setUrl('');
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export default function BlobImage({ blob, alt, className = '', loading = 'eager', decoding = 'async' }: {
  blob: Blob;
  alt: string;
  className?: string;
  loading?: 'eager' | 'lazy';
  decoding?: 'sync' | 'async' | 'auto';
}) {
  const url = useBlobUrl(blob);
  return url ? <img className={className} src={url} alt={alt} draggable={false} loading={loading} decoding={decoding} /> : <div className={`image-loading ${className}`} />;
}
