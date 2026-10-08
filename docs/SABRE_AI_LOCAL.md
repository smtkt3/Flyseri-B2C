# Seri and Sabre AI — localhost integration

Sabre AI for Developers is a collection of services, not a downloadable language model. Seri continues using its configured Gemini model and customer-owned Flyseri tools.

## Implemented

- Server-only CERT MCP adapter at the documented `https://mcp.cert.sabre.com/mcp` endpoint. Existing Sabre OAuth credentials remain on the API server.
- Enable locally with `SERI_SABRE_MCP_ENABLED=true` in the ignored root `.env`. Default is disabled elsewhere.
- Explicit hotel searches expose a narrow `searchHotels` function. It validates airport, dates, adults and child ages and requests the account's preferred currency.
- The adapter initializes MCP and follows the hotel workflow's first two steps: retrieve the hotel search schema and search. The sole permitted executor path is `/v1/hotels/hotelSearch`.
- Hotel results display bounded cards and an explicit test availability label. No hotel purchasing is offered.
- Flight searches retain the existing Sabre integration, search sessions and checkout compatibility.
- Fully specified hotel searches (airport code, ISO stay dates and adult count) also route directly through the audited tool, preserving this capability during an LLM outage. Ambiguous requests still use Gemini.
- Existing authentication, customer ownership, message/tool rate limits and auditing apply to the new Seri function. The model cannot call arbitrary Sabre APIs.

## Local use

Start `corepack pnpm dev:api` and `corepack pnpm dev:web`; open http://localhost:8443 and sign in to use Seri. Example: “Find hotels near KUL from 2026-11-10 to 2026-11-12 for 1 adult.” Empty CERT results are reported honestly.

## Scope and remaining capabilities

This does not activate all products in the Sabre AI collection. Sabre IQ, production supplier entitlements, hotel checkout and autonomous booking/ticket/refund tools require separate implementation and account provisioning. Airline ticket issuance still depends on the approved settlement/printer configuration. No deployment or production configuration changes were made for this work.

Official references:
- https://developer.sabre.com/product-collection/sabre-ai/1.0
- https://developer.sabre.com/product-collection/mcp-server/1.0/help-documentation/setup.html
- https://developer.sabre.com/product-collection/mcp-server/1.0/help-documentation/tool-reference.html

Account checks performed locally: OAuth 200, MCP initialize 200, tools/list 200, workflow/schema retrieval 200. A KUL hotel availability search completed and returned zero hotels. A DFW search returned one Sabre test property with a MYR rate. This proves CERT connectivity and result mapping, not production inventory coverage or hotel booking readiness.

Local Redis was initially unconfigured. With the user's explicit approval, the existing Upstash default-user connection was copied into the ignored local `.env`. Database and Redis readiness now pass, and the atomic Redis rate-limit command succeeds. No cache permissions or production configuration were changed.

Signed-in localhost verification returned the DFW test hotel card and MYR 1029.58 for the sample two-night stay. Gemini generation checks returned intermittent HTTP 503 and later a successful HTTP 200; general conversation reliability therefore remains dependent on that external service. No claim is made that every Sabre AI product is installed or that production purchasing is enabled.

## Travel conversation reliability update

- Natural flight-planning phrases such as “I would like to visit Kuala Lumpur from Dhaka” now enable the flight workflow.
- Explicit English routes with ISO or day/month-name/year dates can ask for missing trip type and passenger counts directly, storing the planning draft in the owned conversation. Follow-up passenger/trip-type answers retain flight-tool access.
- Travel requests receive only relevant travel tools and profile preferences, reducing unrelated context.
- Gemini 3 text models use the documented low thinking level. Transient generation HTTP errors receive one bounded retry before existing fallback logic; returned tool actions are never replayed by this retry.
- Local configuration now uses the verified responsive `gemini-3.5-flash-lite` model with `gemini-3.6-flash` as fallback, using a 20-second budget per generation. Production settings are unchanged.
- Exact user example verified: “i would like to visit Kuala Lumpur from dhaka on 27th december 2027” returns the correct route/date and asks for one-way/return and passenger details.
- Sabre CERT returns HTTP 200 with a structured `SCHEDULES/PROCESS` error for 2027-12-27 (`Invalid requested date`), rather than itinerary descriptors. This exact error now becomes a customer-safe date clarification instead of an outage, survives the flight service boundary, and does not trigger the supplier-outage cooldown. Other provider errors retain their failure behavior.
- Signed-in clean conversation verification: the original message followed by “One way, 1 adult, no children or infants.” now explains that these dates cannot be accepted and asks for another date. Date corrections retain access to flight search.
- Successful flight/hotel tool results render directly through the existing audited formatter. A second LLM generation previously failed after a successful 295-fare Sabre response, hiding the results; it is now skipped. Profile context cannot overwrite the travel result. A signed-in 2026-11-10 DAC–KUL search displayed the supplier fare cards in MYR after this fix.
- Final clean conversation verified all three turns: original natural-language request, passenger follow-up, then “Try 10 November 2026 instead.” The last turn preserved DAC–KUL, one-way, one adult and MYR, displayed 295 CERT flight options, and completed in approximately 5.7 seconds with the existing search cache. This timing is an observed cached request, not a guarantee for uncached supplier searches. API build and database/Redis readiness passed.

Provider references: https://ai.google.dev/gemini-api/docs/generate-content/thinking and https://ai.google.dev/gemini-api/docs/troubleshooting

## Dhaka–Singapore phrasing fix

- Recognizes explicit “go to ORIGIN to DESTINATION”, “fly from ORIGIN to DESTINATION” and “travel to ORIGIN to DESTINATION” route phrasing as well as the original from/to and reverse forms.
- A day/month without a year is retained and prompts for the missing year, trip type and passengers before supplier search. Year-only follow-ups retain flight tool access. The model prompt also requires these details and forbids inventing them.
- Invalid search DTOs now return a customer-safe clarification rather than an unclassified tool error.
- Signed-in verification: the exact uppercase screenshot message asked for the missing year/type/count. The answer “2026, one way, 1 adult, no children or infants, economy.” searched DAC–SIN on 2026-11-25 and displayed 299 CERT options in MYR. The observed uncached full turn took approximately 15 seconds, including 8.5 seconds in flight search; latency remains dependent on suppliers.
- Reviewed the signed-in official Sabre Sample Chatbot Tutorial: https://developer.sabre.com/product-collection/mcp-server/1.0/examples/coding-tutorial.html . It is a Python Google ADK/Vertex AI sample using an LLM and MCPToolset, with separate Google Cloud prerequisites. Seri retains its existing application and configured Gemini provider with server-only Sabre tools; no separate ADK/Vertex service was installed or falsely presented as a hosted Sabre chatbot.

## Persistent flight workflow

- Versioned flight drafts are saved with owned assistant messages in the existing database. A dedicated latest-draft query reads across the full conversation, independent of the LLM history window. No database migration or new credentials are required.
- The draft keeps route names, departure/return dates, missing day/month year, trip type, passenger counts, cabin, currency and planning/search status. Explicit corrections merge into the existing draft. “Start over” writes a reset marker; a new chat is isolated.
- Common English updates are parsed and validated without an LLM request. The workflow asks only for remaining fields, resolves airports through the existing airport directory, and calls the audited flight search automatically when complete. Ambiguous airports require confirmation. Adult-only input uses zero children/infants and Economy unless otherwise requested; actual defaults and currency are retained when searching.
- General AI answers retain the active draft and receive its structured context. Search tool availability follows the active workflow rather than only the latest assistant response or a keyword in the customer reply. Successful model-directed searches also store the confirmed search fields.
- Existing conversations can recover explicit fields from their previous customer messages. Supplier failures retain the draft for retry; invalid dates retain it for correction. Existing rate limits, ownership checks and auditing remain in place.
- Manual localhost verification: original Dhaka–Singapore request, “ONE WAY, 1 ADULT”, page reload, then “2026, ECONOMY” returned 310 CERT flight options in MYR. The first two replies asked only for missing information; the search did not require a model generation call. The API build passed.
- Airport ambiguity now presents named choices and stores which endpoint is awaiting a code. Kuala Lumpur correctly offers KUL and SZB; a short airport-code reply updates the pending endpoint while retaining travel dates, passengers, cabin and currency. The latest-draft ownership check uses a single customer-scoped join rather than an extra conversation query.
- Final correction verification: after changing the destination to Kuala Lumpur and choosing “KUL”, Seri searched DAC–KUL on the retained 2026-11-25 date for one adult in Economy/MYR, returning 294 CERT options. API build and diff whitespace checks passed. No deployment or test suite was run.
- This implements the conversation/workflow foundation. It does not claim universal language understanding, production supplier coverage, new airline entitlements, autonomous ticket issuance, or completion of a model benchmark/evaluation suite.
