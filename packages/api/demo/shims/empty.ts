// The browser demo never calls a hosted model; wording uses the offline template.
export default class Unavailable { constructor() { throw new Error("model provider unavailable in demo"); } }
