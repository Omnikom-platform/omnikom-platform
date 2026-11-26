// R2 sources: each quote is checked word for word by
// node docs/advisor/r1/verify-quotes.mjs docs/advisor/r2/quotes-r2.mjs r2-quotes.json
export const QUOTES = [
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/forms.mdx",
  [
   "This is also called **slot filling**.",
   "You will need to specify a list of slot names to the mandatory `required_slots` key."
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/domain.mdx",
  [
   "Slots are your bot's memory."
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/rules.mdx",
  [
   "Rules describe short pieces of conversations that should always follow the same path.",
   "rules don't have the power to generalize to unseen conversation paths"
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/stories.mdx",
  [
   "A story is a representation of a conversation between a user and an AI assistant"
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/fallback-handoff.mdx",
  [
   "attempt to disambiguate the user's message by asking clarifying questions",
   "The Two-Stage Fallback is made to handle low NLU confidence in multiple stages",
   "reset the state of the conversation as if the turns that happened during the Two-Stage Fallback did not occur"
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/responses.mdx",
  [
   "Rasa will randomly pick one of the two response variations to use",
   "If there are multiple eligible conditional response variations, Rasa will pick one at random."
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/testing-your-assistant.mdx",
  [
   "test stories allow you to provide entire conversations and test that, given certain user input, your model will behave in the expected manner"
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/flow?hl=en",
  [
   "Flows are used to define these topics and the associated conversational paths."
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/handler?hl=en",
  [
   "Routes are called when an end-user input matches an intent and/or some condition on the session status is met.",
   "Every flow has event handlers for the no-match and no-input built-in events",
   "To make routes reusable, you can define route groups",
   "invoked instead of sys.no-input-default and in order"
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/parameter?hl=en",
  [
   "Parameters are used to capture and reference values that have been supplied by the end-user during a session."
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/page?hl=en",
  [
   "Any set session parameter with the same name as a form parameter is copied to the form parameter.",
   "form parameter prompting"
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/test-case?hl=en",
  [
   "To test your agent, you create test cases using the simulator to define golden test cases",
   "For each conversational turn, the agent dialogue is compared from golden to latest run."
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/version?hl=en",
  [
   "immutable snapshot"
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/experiments?hl=en",
  [
   "allocate a portion of live traffic"
  ]
 ],
 [
  "https://developers.cloudflare.com/pages/functions/pricing/",
  [
   "Requests to static assets are free and unlimited"
  ]
 ],
 [
  "https://raw.githubusercontent.com/mustache/spec/master/specs/interpolation.yml",
  [
   "Interpolation tags are used to integrate dynamic content into the template.",
   "Basic Interpolation"
  ]
 ],
 [
  "https://www.w3.org/TR/WCAG22/",
  [
   "The size of the target for pointer inputs is at least 24 by 24 CSS pixels",
   "status messages can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus"
  ]
 ],
 [
  "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=17941.&lawCode=BPC",
  [
   "with the intent to mislead the other person about its artificial identity"
  ]
 ],
 [
  "https://law.justia.com/codes/california/code-bpc/division-7/part-3/chapter-6/section-17941/",
  [
   "with the intent to mislead the other person about its artificial identity"
  ]
 ],
 [
  "https://www.law.cornell.edu/uscode/text/42/3604",
  [
   "with respect to the sale or rental of a dwelling that indicates any preference"
  ]
 ],
 [
  "https://web.dev/articles/inp",
  [
   "An INP below or at 200 milliseconds means a page has good responsiveness"
  ]
 ],
 [
  "https://developers.cloudflare.com/pages/configuration/rollbacks/",
  [
   "Rollbacks allow you to instantly revert your project to a previous production deployment"
  ]
 ],
 [
  "https://raw.githubusercontent.com/mustache/spec/master/specs/interpolation.yml",
  [
   "HTML escaping"
  ]
 ]
];
