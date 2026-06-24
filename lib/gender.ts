// First-name → likely gender inference for the women-only audience
// gate in lib/matching.ts. Curated static lists keep this deterministic
// and dependency-free; everything not on either list returns 'unknown'
// and is treated as "include" by the gate (err toward reach).
//
// Coverage targets the modal US-tech user base + common Indian, Korean,
// Chinese, Vietnamese, and Latino names since they're well-represented
// among our users. Ambiguous names (Jordan, Pat, Casey, Sam, Alex,
// Riley, Taylor, etc.) are deliberately omitted from both lists.
//
// Maintenance: additions only. When a misclassification shows up in
// production, add the name to the appropriate list. Never remove —
// removing changes match outcomes silently.

// Lowercased for case-insensitive lookup.
const FEMALE_NAMES = new Set<string>([
  // Top US women's names + common variants
  'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan',
  'jessica', 'sarah', 'karen', 'lisa', 'nancy', 'betty', 'helen', 'sandra',
  'donna', 'carol', 'ruth', 'sharon', 'michelle', 'laura', 'sarah', 'kimberly',
  'deborah', 'dorothy', 'amy', 'angela', 'ashley', 'brenda', 'emma', 'olivia',
  'cynthia', 'marie', 'janet', 'catherine', 'frances', 'christine', 'samantha',
  'debra', 'rachel', 'carolyn', 'janet', 'virginia', 'maria', 'heather',
  'diane', 'julie', 'joyce', 'victoria', 'kelly', 'christina', 'joan', 'evelyn',
  'lauren', 'judith', 'megan', 'cheryl', 'andrea', 'hannah', 'jacqueline',
  'martha', 'gloria', 'teresa', 'sara', 'janice', 'julia', 'kathryn', 'grace',
  'judy', 'theresa', 'beverly', 'denise', 'marilyn', 'amber', 'danielle',
  'abigail', 'brittany', 'rose', 'natalie', 'sophia', 'isabella', 'charlotte',
  'mia', 'amelia', 'harper', 'evelyn', 'avery', 'ella', 'scarlett', 'grace',
  'chloe', 'victoria', 'madison', 'eleanor', 'penelope', 'aria', 'lily',
  'aubrey', 'willow', 'hazel', 'violet', 'savannah', 'audrey', 'brooklyn',
  'bella', 'claire', 'skylar', 'lucy', 'paisley', 'everly', 'anna', 'caroline',
  'nova', 'genesis', 'emilia', 'kennedy', 'samantha', 'maya', 'willow',
  'kinsley', 'naomi', 'aaliyah', 'elena', 'sarah', 'ariana', 'allison',
  'gabriella', 'alice', 'madelyn', 'cora', 'ruby', 'eva', 'serenity', 'autumn',
  'adeline', 'hailey', 'gianna', 'valentina', 'isla', 'eliana', 'quinn',
  'nevaeh', 'ivy', 'sadie', 'piper', 'lydia', 'alexa', 'josephine',
  'emery', 'julia', 'delilah', 'arianna', 'vivian', 'kaylee', 'sophie',
  'brielle', 'madeline', 'peyton', 'rylee', 'clara', 'hadley', 'melanie',
  'mackenzie', 'reagan', 'adalynn', 'liliana', 'aubree', 'jade', 'katherine',
  'isabelle', 'natalia', 'raelynn', 'maria', 'athena', 'ximena', 'arya',
  'leilani', 'taylor', 'faith', 'rosalie', 'kylie', 'mary', 'margaret',
  'lyla', 'ashley', 'amaya', 'eliza', 'brianna', 'bailey', 'andrea', 'khloe',
  'jasmine', 'melody', 'iris', 'isabela', 'allie', 'jenny', 'jen', 'jenn',
  'jennie', 'kate', 'katie', 'liz', 'beth', 'becky', 'rebecca', 'tina',
  'val', 'vanessa', 'whitney', 'megan', 'meg', 'monica', 'pam', 'pamela',
  'sandy', 'rita', 'paula', 'kim', 'cathy', 'tracy', 'tracey', 'wendy',
  'lori', 'lorraine', 'erica', 'erin', 'tara', 'jeanne', 'connie', 'irene',
  'shannon', 'crystal', 'tiffany', 'leah', 'kara', 'jill', 'jamie', 'jenna',
  'leslie', 'meghan', 'meaghan', 'caitlin', 'kaitlin', 'kelly', 'kris',
  'krista', 'kristen', 'kristin', 'kristine', 'kirsten', 'casey', 'haley',
  'hayley', 'monique', 'nicole', 'nikki', 'nikita', 'priscilla', 'maddie',
  'maddy', 'mandy', 'cassie', 'cassandra', 'felicia', 'jenna', 'kayla',
  'shauna', 'shawna', 'simone', 'stacy', 'stacey', 'tonya', 'yvonne',
  'sherri', 'sheri', 'sherry',
  // Indian / South Asian women's names
  'priya', 'pooja', 'neha', 'ananya', 'aanya', 'aditi', 'aisha', 'aishwarya',
  'amrita', 'anika', 'anita', 'anjali', 'aparna', 'arpita', 'asha', 'avani',
  'bhavna', 'chitra', 'deepa', 'deepika', 'divya', 'gauri', 'geeta', 'isha',
  'jaya', 'kavita', 'kavya', 'lakshmi', 'leela', 'madhuri', 'mala', 'mansi',
  'meena', 'meenakshi', 'meera', 'monika', 'nandini', 'nandita', 'nikita',
  'nisha', 'padma', 'pallavi', 'parvati', 'pavithra', 'pooja', 'poonam',
  'pratibha', 'preeti', 'preethi', 'preetha', 'priti', 'priyanka', 'rachna',
  'radha', 'rakhi', 'rashmi', 'rekha', 'renu', 'reshma', 'ritika', 'rohini',
  'roshni', 'ruchi', 'rupa', 'sandhya', 'sangeeta', 'sanjana', 'sapna',
  'saraswati', 'savita', 'seema', 'shalini', 'shanti', 'shilpa', 'shobha',
  'shradha', 'shreya', 'shruti', 'sita', 'smita', 'sneha', 'sonal', 'sonali',
  'sonia', 'soumya', 'sridevi', 'srilatha', 'sudha', 'suhasini', 'sujata',
  'suman', 'sumita', 'suneetha', 'sunita', 'supriya', 'sushma', 'swapna',
  'swati', 'tara', 'tripti', 'uma', 'urmila', 'usha', 'vandana', 'varsha',
  'vidya', 'vimala', 'vinita',
  // Chinese / East Asian women's names commonly anglicized
  'mei', 'xiaolan', 'yan', 'ling', 'lin', 'fang', 'hong', 'hui', 'juan',
  'min', 'na', 'ping', 'qing', 'rui', 'wen', 'xiao', 'xin', 'ying', 'yu',
  'yuan', 'yue', 'zhen', 'jingyi', 'jiao', 'shan', 'jia', 'mengqi',
  // Korean women's names
  'eunji', 'jiwoo', 'minji', 'sujin', 'yuna', 'jiyeon', 'soyoung', 'hyejin',
  'jihye', 'minjeong', 'haeun', 'seoyeon', 'soomin', 'eunhye',
  // Vietnamese women's names
  'lan', 'huong', 'thuy', 'mai', 'linh', 'phuong', 'thao', 'trang', 'thanh',
  // Latina names
  'guadalupe', 'lupe', 'maribel', 'mariana', 'mariella', 'rosario', 'rocio',
  'gabriela', 'carmen', 'consuelo', 'dolores', 'esperanza', 'francisca',
  'inés', 'ines', 'leticia', 'lucia', 'lupita', 'marisol', 'paloma', 'pilar',
  'rosa', 'silvia', 'soledad', 'yolanda',
  // Arabic / MENA women's names
  'aisha', 'fatima', 'mariam', 'noor', 'nour', 'huda', 'layla', 'leila',
  'malak', 'rania', 'sarah', 'yasmin', 'zainab', 'zara',
  // Common Western/EU women's names
  'sofia', 'sofie', 'elin', 'astrid', 'ingrid', 'inga', 'sigrid', 'birgit',
  'helga', 'greta', 'frieda', 'liesel', 'gisela', 'gertrude', 'beate',
  'chiara', 'giulia', 'francesca', 'martina', 'silvia', 'valeria', 'valentina',
  'eloise', 'amélie', 'amelie', 'celine', 'celeste', 'chantal', 'colette',
  'genevieve', 'margaux', 'manon', 'oceane', 'océane',
])

const MALE_NAMES = new Set<string>([
  // Top US men's names + common variants
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard',
  'joseph', 'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony',
  'donald', 'mark', 'paul', 'steven', 'andrew', 'kenneth', 'george', 'joshua',
  'kevin', 'brian', 'edward', 'ronald', 'timothy', 'jason', 'jeffrey', 'ryan',
  'jacob', 'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry',
  'justin', 'scott', 'brandon', 'benjamin', 'samuel', 'gregory', 'frank',
  'alexander', 'raymond', 'patrick', 'jack', 'dennis', 'jerry', 'tyler',
  'aaron', 'jose', 'henry', 'douglas', 'peter', 'adam', 'nathan', 'zachary',
  'walter', 'kyle', 'harold', 'carl', 'jeremy', 'gerald', 'keith', 'roger',
  'arthur', 'terry', 'lawrence', 'sean', 'christian', 'albert', 'joe',
  'ethan', 'austin', 'jesse', 'willie', 'billy', 'bryan', 'bruce', 'jordan',
  'ralph', 'roy', 'noah', 'dylan', 'eugene', 'wayne', 'alan', 'juan', 'louis',
  'russell', 'philip', 'bobby', 'johnny', 'mason', 'logan', 'liam',
  'oliver', 'elijah', 'lucas', 'levi', 'asher', 'caleb', 'jackson',
  'connor', 'isaac', 'owen', 'wyatt', 'luke', 'gabriel', 'julian', 'mateo',
  'leo', 'hudson', 'ezra', 'maverick', 'muhammad', 'theodore', 'theo',
  'aiden', 'aidan', 'evan', 'eli', 'colton', 'cooper', 'easton', 'hunter',
  'jose', 'miles', 'micah', 'jaxon', 'jayden', 'cameron', 'parker',
  'roman', 'sebastian', 'cody', 'collin', 'colin', 'tristan', 'wesley',
  'xavier', 'zane', 'damian', 'declan', 'finn', 'graham', 'jared', 'jasper',
  'leonard', 'leonardo', 'lincoln', 'manuel', 'martin', 'maxwell', 'max',
  'miguel', 'morgan', 'nathaniel', 'phillip', 'rafael', 'roberto', 'rodney',
  'russell', 'ricardo', 'salvador', 'shaun', 'simon', 'spencer',
  'stanley', 'stuart', 'todd', 'tony', 'tom', 'tommy', 'travis', 'troy',
  'vance', 'vernon', 'victor', 'vince', 'vincent', 'wade', 'warren', 'wendell',
  'wilbur', 'willis', 'milton', 'mitch', 'mitchell', 'morton', 'murray',
  'neil', 'nelson', 'norman', 'omar', 'oscar', 'pablo', 'pedro', 'percy',
  'perry', 'preston', 'rocky', 'rodrigo', 'rolando', 'rufus', 'sergio',
  'sidney', 'silas', 'solomon', 'stewart', 'sylvester', 'reginald',
  'rene', 'ricky', 'rick', 'jeffery', 'jeff', 'jesse', 'jimmy', 'jim',
  'tomas', 'tomás', 'enrique', 'ernesto', 'fernando', 'francisco', 'gilberto',
  'guillermo', 'hector', 'horacio', 'humberto', 'ignacio', 'ismael', 'javier',
  'jorge', 'lazaro', 'leonel', 'mauricio', 'orlando', 'osvaldo',
  // Indian / South Asian men's names
  'aakash', 'aarav', 'aarush', 'aayush', 'abhay', 'abhinav', 'abhishek',
  'aditya', 'akash', 'amit', 'amitabh', 'anand', 'anil', 'aniruddh', 'ankit',
  'ankur', 'anubhav', 'anuj', 'arjun', 'arnav', 'arpit', 'aryan', 'ashish',
  'ashok', 'ashwin', 'atharv', 'avinash', 'ayush', 'bharat', 'bhavesh',
  'chetan', 'chirag', 'dhiraj', 'dhruv', 'dinesh', 'gaurav', 'girish',
  'gopal', 'govind', 'harish', 'hemant', 'himanshu', 'hitesh', 'imran',
  'jagdish', 'jatin', 'jay', 'jayesh', 'jignesh', 'kapil', 'karan', 'kartik',
  'kaushik', 'keshav', 'krishna', 'krishnan', 'lakshman', 'manish', 'manoj',
  'mayur', 'mihir', 'mohan', 'mohit', 'mukesh', 'naveen', 'navin', 'nikhil',
  'nilesh', 'nitin', 'om', 'pankaj', 'parag', 'paresh', 'pawan', 'piyush',
  'pradeep', 'prakash', 'pranav', 'prasad', 'prashant', 'praveen', 'prem',
  'punit', 'rachit', 'rahul', 'raj', 'rajat', 'rajeev', 'rajendra', 'rajesh', 'raju',
  'ram', 'ramakrishna', 'ramesh', 'ranjit', 'ravi', 'rohan', 'rohit', 'roshan',
  'sachin', 'salman', 'samir', 'sandeep', 'sanjay', 'sanjeev', 'sanket',
  'satish', 'satya', 'saurabh', 'shailesh', 'shantanu', 'shashank', 'shashi',
  'shivam', 'shrikant', 'siddharth', 'sourav', 'srikanth', 'subhash', 'sudhir',
  'sumit', 'sundar', 'suresh', 'sushant', 'swapnil', 'tanmay', 'tarun',
  'tushar', 'umesh', 'vaibhav', 'varun', 'venkat', 'venkatesh', 'vijay',
  'vikas', 'vikram', 'vimal', 'vinay', 'vinod', 'vipul', 'virat', 'vishal',
  'vishnu', 'vivek', 'yash', 'yogesh',
  // Chinese / East Asian men's names commonly anglicized
  'wei', 'jun', 'yong', 'liang', 'cheng', 'feng', 'gang', 'hao', 'jian',
  'kai', 'long', 'ming', 'peng', 'qiang', 'tao', 'wang', 'wenbo', 'xiang',
  'xu', 'yang', 'yi', 'yu', 'yuan', 'zhang', 'zheng', 'zhi', 'zhong', 'zhou',
  // Korean men's names
  'minjun', 'jiho', 'doyun', 'seojun', 'siwoo', 'jiwon', 'minsoo', 'hyunwoo',
  'junseo', 'jaewon', 'sungjin',
  // Vietnamese men's names
  'tuan', 'minh', 'duy', 'phong', 'long', 'nam', 'son', 'binh', 'cuong',
  'duc', 'hung', 'khanh', 'quang', 'thanh', 'tien', 'tri',
  // Arabic / MENA men's names
  'ahmed', 'ahmad', 'ali', 'amir', 'hassan', 'hussein', 'ibrahim', 'khalid',
  'mahmoud', 'mohammed', 'mohamed', 'mustafa', 'omar', 'rashid', 'said',
  'tariq', 'youssef', 'yusuf', 'zaid',
  // European men's names
  'gunther', 'hans', 'helmut', 'klaus', 'jurgen', 'jürgen', 'wolfgang',
  'dieter', 'franz', 'fritz', 'horst', 'siegfried',
  'enzo', 'giovanni', 'matteo', 'lorenzo', 'leonardo', 'alessandro', 'andrea',
  'thierry', 'thibault', 'pascal', 'sebastien', 'sébastien', 'gaspard',
])

// Strips accents + lowercases + trims, then takes the first whitespace-
// separated token so callers can pass a full name when no firstName is
// available ("John Smith" -> "john"). Robust to "André" vs "andre",
// "  John" vs "john", "Mary Ann Smith" -> "mary", etc.
function normalizeFirstName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .split(/\s+/)[0] || ''
}

export function inferLikelyGender(
  firstName: string | null | undefined,
): 'female' | 'male' | 'unknown' {
  if (!firstName) return 'unknown'
  const name = normalizeFirstName(firstName)
  if (!name) return 'unknown'
  if (FEMALE_NAMES.has(name)) return 'female'
  if (MALE_NAMES.has(name)) return 'male'
  return 'unknown'
}
