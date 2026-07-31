async function run() {
  const query = `
    query {
      contractState(address: "1acd1979f41be84e3d5271a3962d3129ce6ab19daee27a7c9381eefc7ff0725a") {
        data
      }
    }
  `;
  try {
    const res = await fetch("https://indexer.preview.midnight.network/api/v1/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const text = await res.text();
    console.log("RESPONSE:", text);
  } catch (e) {
    console.error("ERROR:", e);
  }
}
run();
