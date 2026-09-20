// Which issue this DEVICE has already read.
//
// One constant, shared by the two places that ask the question — the chip's
// badge in Home's nav row and the notice card in Home's notices — because two
// copies of a localStorage key is exactly how a badge and a card come to
// disagree about whether there is something new.
//
// Per-device on purpose: it is the same class of state as a remembered tab,
// and reading an issue on the phone while the laptop still offers it is the
// correct, unsurprising behaviour for a newsletter.
export const NEWSLETTER_READ_KEY = 'cinemaRoll.newsletter.lastRead';
