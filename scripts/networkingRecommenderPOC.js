import search from "../lib/search.js";

const INDEX_NAME = "test-index";

/**
 * Index mappings
 * profile_text is a concatenation of all answers for search
 */
const mappings = {
  properties: {
    name: { type: "text" },
    linkedin: { type: "keyword" },

    companiesWorkedAt: { type: "text" },
    technologiesExperienced: { type: "text" },
    technologiesInterested: { type: "text" },
    industriesInterested: { type: "text" },
    networkingGoal: { type: "text" },

    profile_text: { type: "text" }
  }
};

const settings = {
  number_of_shards: 1,
  number_of_replicas: 2
};

const profiles = [
  {
    id: "1",
    name: "Alex Chen",
    linkedin: "https://linkedin.com/in/alexchen",
    companiesWorkedAt: "Jane Street",
    technologiesExperienced: "Python, OCaml, low-latency systems",
    technologiesInterested: "Rust, performance engineering",
    industriesInterested: "Quant trading, finance",
    networkingGoal: "Meet engineers building high performance trading systems"
  },
  {
    id: "2",
    name: "Priya Patel",
    linkedin: "https://linkedin.com/in/priyapatel",
    companiesWorkedAt: "Amazon",
    technologiesExperienced: "Java, AWS, DynamoDB",
    technologiesInterested: "Search systems, OpenSearch",
    industriesInterested: "Cloud infrastructure",
    networkingGoal: "Learn how large-scale distributed systems are designed"
  },
  {
    id: "3",
    name: "Samantha Lee",
    linkedin: "https://linkedin.com/in/samanthalee",
    companiesWorkedAt: "Apple",
    technologiesExperienced: "Swift, SwiftUI, iOS",
    technologiesInterested: "VisionOS, ARKit",
    industriesInterested: "Consumer hardware",
    networkingGoal: "Meet other mobile engineers working on next-gen apps"
  },
  {
    id: "4",
    name: "Michael Torres",
    linkedin: "https://linkedin.com/in/michaeltorres",
    companiesWorkedAt: "Meta",
    technologiesExperienced: "React, TypeScript, GraphQL",
    technologiesInterested: "Product management",
    industriesInterested: "Social platforms",
    networkingGoal: "Transition from engineering to PM roles"
  },
  {
    id: "5",
    name: "Daniel Novak",
    linkedin: "https://linkedin.com/in/danielnovak",
    companiesWorkedAt: "Stripe",
    technologiesExperienced: "Ruby, payments APIs",
    technologiesInterested: "Fintech compliance",
    industriesInterested: "Fintech",
    networkingGoal: "Exchange lessons scaling financial products"
  },
  {
    id: "6",
    name: "Fatima Hassan",
    linkedin: "https://linkedin.com/in/fatimahassan",
    companiesWorkedAt: "Google",
    technologiesExperienced: "Go, Kubernetes, SRE",
    technologiesInterested: "Platform reliability",
    industriesInterested: "Infrastructure",
    networkingGoal: "Discuss production reliability best practices"
  },
  {
    id: "7",
    name: "Ryan Kim",
    linkedin: "https://linkedin.com/in/ryankim",
    companiesWorkedAt: "Early-stage startup",
    technologiesExperienced: "Next.js, Prisma, PostgreSQL",
    technologiesInterested: "AI developer tools",
    industriesInterested: "SaaS",
    networkingGoal: "Meet founders and early engineers"
  },
  {
    id: "8",
    name: "Isabella Rossi",
    linkedin: "https://linkedin.com/in/isabellarossi",
    companiesWorkedAt: "McKinsey",
    technologiesExperienced: "Data analysis, SQL",
    technologiesInterested: "Product analytics",
    industriesInterested: "Consulting, tech strategy",
    networkingGoal: "Bridge strategy and product roles"
  },
  {
    id: "9",
    name: "Tom Williams",
    linkedin: "https://linkedin.com/in/tomwilliams",
    companiesWorkedAt: "Netflix",
    technologiesExperienced: "Java, microservices",
    technologiesInterested: "Streaming optimization",
    industriesInterested: "Media",
    networkingGoal: "Learn about real-time data pipelines"
  },
  {
    id: "10",
    name: "Nina Müller",
    linkedin: "https://linkedin.com/in/ninamueller",
    companiesWorkedAt: "SAP",
    technologiesExperienced: "ABAP, enterprise systems",
    technologiesInterested: "Cloud migration",
    industriesInterested: "Enterprise software",
    networkingGoal: "Understand cloud-native architectures"
  },
  {
    id: "11",
    name: "Ethan Brooks",
    linkedin: "https://linkedin.com/in/ethanbrooks",
    companiesWorkedAt: "Tesla",
    technologiesExperienced: "Embedded C++, vehicle systems",
    technologiesInterested: "Autonomous driving",
    industriesInterested: "Automotive",
    networkingGoal: "Meet engineers working on autonomy stacks"
  },
  {
    id: "12",
    name: "Lucía Gómez",
    linkedin: "https://linkedin.com/in/luciagomez",
    companiesWorkedAt: "Uber",
    technologiesExperienced: "Python backend, geospatial systems",
    technologiesInterested: "Machine learning",
    industriesInterested: "Mobility",
    networkingGoal: "Learn how ML improves logistics"
  },
  {
    id: "13",
    name: "Kevin O'Neil",
    linkedin: "https://linkedin.com/in/kevinoneil",
    companiesWorkedAt: "Goldman Sachs",
    technologiesExperienced: "Java, risk platforms",
    technologiesInterested: "Cloud cost optimization",
    industriesInterested: "Finance",
    networkingGoal: "Compare finance and big tech engineering"
  },
  {
    id: "14",
    name: "Aisha Rahman",
    linkedin: "https://linkedin.com/in/aisharahman",
    companiesWorkedAt: "Shopify",
    technologiesExperienced: "Rails, e-commerce platforms",
    technologiesInterested: "Headless commerce",
    industriesInterested: "E-commerce",
    networkingGoal: "Meet product-focused engineers"
  },
  {
    id: "15",
    name: "Victor Alvarez",
    linkedin: "https://linkedin.com/in/victoralvarez",
    companiesWorkedAt: "Spotify",
    technologiesExperienced: "Scala, data pipelines",
    technologiesInterested: "Real-time analytics",
    industriesInterested: "Music tech",
    networkingGoal: "Discuss large-scale data ingestion"
  },
  {
    id: "16",
    name: "Hannah Park",
    linkedin: "https://linkedin.com/in/hannahpark",
    companiesWorkedAt: "Airbnb",
    technologiesExperienced: "Experimentation platforms",
    technologiesInterested: "Causal inference",
    industriesInterested: "Travel",
    networkingGoal: "Share insights on A/B testing at scale"
  },
  {
    id: "17",
    name: "Marco Silva",
    linkedin: "https://linkedin.com/in/marcosilva",
    companiesWorkedAt: "Booking.com",
    technologiesExperienced: "PHP, backend systems",
    technologiesInterested: "Platform modernization",
    industriesInterested: "Travel tech",
    networkingGoal: "Learn from legacy modernization stories"
  },
  {
    id: "18",
    name: "Emily Johnson",
    linkedin: "https://linkedin.com/in/emilyjohnson",
    companiesWorkedAt: "Microsoft",
    technologiesExperienced: "C#, Azure",
    technologiesInterested: "Developer tooling",
    industriesInterested: "Cloud",
    networkingGoal: "Meet engineers building internal platforms"
  },
  {
    id: "19",
    name: "Arjun Mehta",
    linkedin: "https://linkedin.com/in/arjunmehta",
    companiesWorkedAt: "Flipkart",
    technologiesExperienced: "Supply chain systems",
    technologiesInterested: "Search relevance",
    industriesInterested: "E-commerce",
    networkingGoal: "Understand how search impacts conversion"
  },
  {
    id: "20",
    name: "Sophie Dubois",
    linkedin: "https://linkedin.com/in/sophiedubois",
    companiesWorkedAt: "Datadog",
    technologiesExperienced: "Observability, metrics",
    technologiesInterested: "OpenTelemetry",
    industriesInterested: "Developer tools",
    networkingGoal: "Connect with infra engineers using observability"
  }
];

async function run() {
  const created = await search.createIndex({
    indexName: INDEX_NAME,
    mappings,
    settings
  });

  console.log(created ? "Index created" : "Index already exists");

  for (const profile of profiles) {
    const profileText = `
      ${profile.name}
      ${profile.companiesWorkedAt}
      ${profile.technologiesExperienced}
      ${profile.technologiesInterested}
      ${profile.industriesInterested}
      ${profile.networkingGoal}
    `;

    await search.indexDocument({
      indexName: INDEX_NAME,
      id: profile.id,
      document: {
        ...profile,
        profile_text: profileText
      }
    });
  }

  console.log("Seeded test-index with 20 profiles");
}

run().catch(console.error);
