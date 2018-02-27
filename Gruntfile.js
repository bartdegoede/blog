var matter = require('gray-matter');
var S = require('string');
var conzole = require('conzole');

var CONTENT_PATH_PREFIX = 'content';

module.exports = function(grunt) {

    grunt.registerTask('search-index', function() {

        grunt.log.writeln('Build pages index');

        var indexPages = function() {
            var pagesIndex = [];
            grunt.file.recurse(CONTENT_PATH_PREFIX, function(abspath, rootdir, subdir, filename) {
                grunt.verbose.writeln('Parse file:', abspath);
                d = processFile(abspath, filename);
                if (d !== undefined) {
                    pagesIndex.push(d);
                }
            });
            return pagesIndex;
        };

        var processFile = function(abspath, filename) {
            var pageIndex;

            if (S(filename).endsWith('.html')) {
                pageIndex = processHTMLFile(abspath, filename);
            }
            else if (S(filename).endsWith('.md')) {
                pageIndex = processMDFile(abspath, filename);
            }

            return pageIndex;
        };

        var processHTMLFile = function(abspath, filename) {
            var content = grunt.file.read(abspath, filename);
            var pageName = S(filename).chompRight('.html').s;
            var href = S(abspath).chompLeft(CONTENT_PATH_PREFIX).s;
            return {
                title: pageName,
                href: href,
                content: S(content).trim().stripTags().stripPunctuation().s
            };
        };

        var processMDFile = function(abspath, filename) {
            var content = matter(grunt.file.read(abspath, filename));
            if (content.data.draft) {
                conzole.log('Draft; do not index', abspath);
                return;
            }
            var pageIndex;
            return {
                title: content.data.title,
                tags: content.data.categories,
                href: content.data.slug,
                content: S(content.content).trim().stripTags().stripPunctuation().s
            };
        };

        grunt.file.write('static/js/lunr/PagesIndex.json', JSON.stringify(indexPages()));
        grunt.log.ok('Index built');
    });
};
