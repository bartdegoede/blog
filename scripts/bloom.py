import mmh3

class Bloomfilter(object):
    def __init__(self, m=15, k=3):
        self.m = m
        self.k = k
        # we use a list of Booleans to represent our bit array for simplicity
        self.bit_array = [False for i in range(self.m)]

    def __repr__(self):
        return '<Bloomfilter size: {}>'.format(self.m)

    def add(self, element):
        """
        Add an element to the filter. Murmurhash3 gives us hash values
        distributed uniformly enough we can use different seeds to
        represent different hash functions
        """
        for i in range(self.k):
            # this will give us a number between 0 and m - 1
            digest = mmh3.hash(element, i, signed=False) % self.m
            self.bit_array[digest] = True

    def check(self, element):
        """
        To check whether element is in the filter, we hash the element with
        the same hash functions as the add functions (using the seed). If one
        of them doesn't occur in our bit_array, the element is not in there
        (only a value that hashes to all of the same indices we've already
        seen before).
        """
        for i in range(self.k):
            digest = mmh3.hash(element, i) % self.m
            if self.bit_array[digest] == False:
                # if any of the bits hasn't been set, then it's not in
                # the filter
                return False
        return True

if __name__ == '__main__':
    bf = Bloomfilter()
    bf.add('hello')
    bf.add('world')
    assert(bf.check('hello') == True)
    assert(bf.check('hello world') == False)
