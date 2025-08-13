import React, { useEffect, useState } from 'react';

export default function PaymentDetailPage({ refId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        let res = await fetch(`/api/payments/ref/${refId}`);
        if (res.ok) {
          setData(await res.json());
        } else if (res.status === 404) {
          // try to fetch IPN event for this ref
          let ipnRes = await fetch(`/api/ipn-events?ref=${refId}`);
          if (ipnRes.ok) {
            const ipnData = await ipnRes.json();
            setData({ ipnOnly: true, ipn: ipnData[0] || null });
          }
        } else {
          throw new Error(`Failed to load payment ${refId}`);
        }
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refId]);

  if (loading) return <div>Loading payment {refId}...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!data) return <div>No data found for {refId}</div>;

  if (data.ipnOnly) {
    return (
      <div>
        <h2>No payment row found for {refId}</h2>
        <pre>{JSON.stringify(data.ipn, null, 2)}</pre>
        <button
          onClick={async () => {
            await fetch('/api/admin/backfill-from-ipn', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ipnId: data.ipn.id }),
            });
            window.location.reload();
          }}
        >
          Create payment from this IPN
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Payment Details for {refId}</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}