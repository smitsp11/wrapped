/**
 * The glue of any sentence: everyday English, everyday verbs, contractions, time words, who you're talking to
 * and texting shorthand. A phrase can't start or end with one ("i think", "in the", "going to", "bro what",
 * "idk tho"), though one can sit inside ("run it back").
 */
export const GLUE_WORDS = new Set([
  // everyday English
  'the', 'and', 'but', 'for', 'nor', 'not', 'yet', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
  'having', 'does', 'did', 'doing', 'done', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might',
  'must', 'you', 'your', 'yours', 'yourself', 'him', 'his', 'himself', 'her', 'hers', 'herself', 'she', 'its',
  'itself', 'our', 'ours', 'they', 'them', 'their', 'theirs', 'themselves', 'myself', 'who', 'whom', 'whose',
  'what', 'which', 'when', 'where', 'why', 'how', 'that', 'this', 'these', 'those', 'there', 'here', 'then',
  'than', 'with', 'from', 'into', 'onto', 'about', 'above', 'below', 'after', 'before', 'again', 'against',
  'between', 'during', 'under', 'over', 'through', 'thru', 'till', 'until', 'while', 'since', 'around', 'off',
  'out', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'much', 'many', 'some', 'such', 'other', 'another',
  'own', 'same', 'only', 'also', 'just', 'jus', 'even', 'ever', 'every', 'either', 'else', 'very', 'too',
  'still', 'already', 'always', 'never', 'though', 'tho', 'although', 'because', 'cause', 'cuz', 'coz', 'cus',
  'bcuz', 'enough', 'least', 'lot', 'lots', 'one', 'ones', 'two', 'something', 'anything', 'everything',
  'nothing', 'someone', 'anyone', 'everyone', 'nobody', 'somebody', 'everybody', 'anybody', 'thing', 'things',
  'stuff', 'way', 'kind', 'kinda', 'sort', 'sorta', 'bit', 'part', 'whole', 'half', 'now', 'yes', 'nope',
  'okay', 'well', 'like', 'really', 'maybe', 'please', 'thanks', 'thank', 'sorry', 'people',
  'otherwise',
  // everyday verbs
  'get', 'gets', 'got', 'getting', 'gotten', 'goes', 'going', 'went', 'gone', 'come', 'comes', 'coming', 'came',
  'make', 'makes', 'making', 'made', 'take', 'takes', 'taking', 'took', 'taken', 'give', 'gives', 'giving',
  'gave', 'put', 'puts', 'say', 'says', 'saying', 'said', 'tell', 'tells', 'telling', 'told', 'ask', 'asks',
  'asking', 'asked', 'see', 'sees', 'seeing', 'saw', 'seen', 'look', 'looks', 'looking', 'looked', 'know',
  'knows', 'knew', 'known', 'think', 'thinks', 'thinking', 'thought', 'want', 'wants', 'wanted', 'need',
  'needs', 'needed', 'feel', 'feels', 'feeling', 'felt', 'try', 'tries', 'trying', 'tried', 'use', 'uses',
  'using', 'used', 'keep', 'keeps', 'kept', 'let', 'lets', 'leave', 'leaving', 'left', 'call', 'calls',
  'called', 'calling', 'mean', 'means', 'meant', 'find', 'finds', 'found', 'show', 'shows', 'start', 'started',
  'talk', 'talking', 'talked', 'reach', 'send', 'sent', 'check', 'wait', 'waiting', 'happen', 'happens', 'happened', 'happening',
  'help', 'hear', 'heard', 'sure', 'bring', 'bringing', 'pick', 'stop', 'forgot', 'remember', 'rmr', 'believe', 'guess',
  'hope', 'love', 'hate', 'care', 'works', 'worked', 'trust', 'swear', 'sound', 'sounds',
  // contractions, with and without the apostrophe
  "i'm", "i'll", 'ill', "i've", 'ive', "i'd", "you're", 'youre', "you'll", 'youll', "you've", 'youve', "you'd",
  "he's", 'hes', "she's", 'shes', "it's", "it'll", "we're", "we'll", "we've", "they're", 'theyre', "they'll",
  "they've", "that's", 'thats', "there's", 'theres', "what's", 'whats', "who's", 'whos', "where's", "how's",
  "let's", "don't", 'dont', "doesn't", 'doesnt', "didn't", 'didnt', "can't", 'cant', "won't", 'wont',
  "wouldn't", 'wouldnt', "shouldn't", 'shouldnt', "couldn't", 'couldnt', "isn't", 'isnt', "aren't", 'arent',
  "wasn't", 'wasnt', "weren't", "haven't", 'havent', "hasn't", "hadn't", "ain't", 'aint', "y'all", 'yall',
  "would've", "should've", "could've", 'gonna', 'gon', 'gna', 'wanna', 'gotta', 'tryna', 'finna', 'imma', 'ima',
  'needa', 'hafta', 'lemme', 'gimme', 'dunno', 'outta', 'ion',
  // time
  'today', 'tdy', 'tonight', 'tomorrow', 'tmr', 'tmrw', 'tmmrw', 'yesterday', 'yday', 'later', 'soon', 'early', 'late',
  'day', 'days', 'week', 'weeks', 'weekend', 'month', 'months', 'year', 'years', 'time', 'times', 'hour',
  'hours', 'min', 'mins', 'minute', 'minutes', 'sec', 'secs', 'morning', 'night', 'last', 'next', 'first',
  'second', 'ago', 'once', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  // who you're talking to, and hellos ("bro", "hey guys")
  'bro', 'bros', 'brodie', 'vro', 'bra', 'blud', 'twin', 'gang', 'broski', 'bruh', 'bruv', 'dawg', 'dude', 'man',
  'mans', 'guy', 'guys', 'fam', 'boys', 'girl', 'homie', 'buddy', 'yoo', 'hey', 'heyy', 'hii', 'hello', 'sup',
  'wassup',
  // texting shorthand
  'lol', 'lmao', 'lmfao', 'rofl', 'omg', 'omfg', 'wtf', 'wth', 'idk', 'idc', 'idt', 'idts', 'ikr', 'imo', 'tbh',
  'tbf', 'ngl', 'frfr', 'ong', 'istg', 'smh', 'nvm', 'btw', 'lmk', 'wdym', 'wym', 'hbu', 'wbu', 'hmu', 'wyd',
  'wsg', 'brb', 'ttyl', 'irl', 'asap', 'fyi', 'atp', 'icl', 'asf', 'abt', 'acc', 'prolly', 'probs', 'rly',
  'srsly', 'rlly', 'alw', 'prob', 'shud', 'wtv', 'tmw', 'nun', 'non', 'rii', 'smth', 'smn', 'sth', 'ppl', 'thx', 'tysm', 'pls', 'plz', 'ofc', 'obv', 'obvi', 'def', 'defo', 'alr',
  'aight', 'ight', 'okk', 'okok', 'yea', 'yeah', 'yeh', 'yep', 'yup', 'yah', 'yee', 'yeye', 'yuh', 'nah', 'naw',
  'bet', 'facts', 'true', 'real', 'fair', 'sum', 'wit', 'wid', 'dat', 'dis', 'dem', 'den',
])

/**
 * Slang, filler and reactions. Never a top word on its own, but a phrase made of them can be
 * ("super calm"): whether it's special to a chat is left to the ranking.
 */
export const FILLER_WORDS = new Set([
  // filler and slang
  'literally', 'actually', 'basically', 'genuinely', 'honestly', 'seriously', 'definitely', 'probably',
  'totally', 'pretty', 'super', 'mad', 'hella', 'bare', 'lowkey', 'lowk', 'highkey', 'deadass',
  'ahlie', 'ting', 'shi', 'fuh', 'ohh', 'ahh', 'uhh', 'umm', 'hmm', 'huh', 'wow', 'woah', 'whoa', 'yay', 'oop',
  'oops', 'down', 'back',
  // reactions
  'good', 'great', 'nice', 'cool', 'bad', 'fine', 'crazy', 'insane', 'wild', 'fire', 'tuff', 'goated', 'lit',
  'valid', 'mid', 'cooked', 'proper', 'perfect', 'stupid', 'rip', 'dayum', 'sick', 'dead', 'funny', 'chill', 'calm', 'right', 'wrong', 'best', 'better',
  'worse', 'worst', 'big', 'little', 'lil', 'long', 'new', 'old', 'hard', 'easy', 'free', 'full', 'happy',
  'holy', 'god', 'damn', 'dang', 'hell', 'ass', 'shit', 'fuck', 'fucking', 'fucked', 'crap',
])

/**
 * Words that say nothing about a chat or a person on their own. Top words and signature words skip these.
 * Words under 3 letters are already dropped, and stretched spellings ("yesss", "shiii") are checked here in their short form too.
 */
export const STOPWORDS = new Set([...GLUE_WORDS, ...FILLER_WORDS])

/** Laughing ("hahaha", "lmaooo", "lolol", "hehe", "xd") in any length. */
export const LAUGHTER = /^(?:a?(?:h+a+)+h*|(?:h+e+)+h*|(?:l+o+)+l+|l+m+f*a+o+|x+d+|a+h+a+[ha]*|j+a+j+[ja]*|k{3,})$/
