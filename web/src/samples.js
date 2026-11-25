// Evaluation plan B1, "Try a sample": a sample (as GET /api/samples lists it) -> the upload form's files,
// in page order, as if they had been dropped in.

/** [File] for each of the sample's screenshots; fetch is passed in so it can be tested on its own. */
export async function sampleFiles(sample, fetchImpl = globalThis.fetch) {
  return Promise.all(
    sample.images.map(async (url, i) => {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`Couldn't load the sample “${sample.name}” (HTTP ${res.status})`);
      return new File([await res.blob()], `${sample.id}-${i + 1}.png`, { type: "image/png" });
    })
  );
}
