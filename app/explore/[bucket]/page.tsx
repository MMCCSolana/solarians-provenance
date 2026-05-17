import { Suspense } from "react";
import BucketExplorer from "@/components/BucketExplorer";
import { BUCKET_CONFIGS } from "@/lib/provenance";

export function generateStaticParams() {
  return BUCKET_CONFIGS.map((config) => ({
    bucket: config.id
  }));
}

export default function ExploreBucketPage({ params }: { params: { bucket: string } }) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-950/70 p-10 text-center text-sm text-slate-300">
            Loading explorer...
          </div>
        </main>
      }
    >
      <BucketExplorer bucket={params.bucket} />
    </Suspense>
  );
}
