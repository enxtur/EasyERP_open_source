var mongoose = require('mongoose');
var async = require('async');
var WorkflowHandler = require('./workflow');
var _ = require('lodash');

var CONSTANTS = require('../constants/modules');
var MAINCONSTANTS = require('../constants/mainConstants');

var Payment = function (models, event) {
    "use strict";
    var access = require("../Modules/additions/access.js")(models);
    var composeExpensesAndCache = require('../helpers/expenses')(models);

    var rewriteAccess = require('../helpers/rewriteAccess');
    var wTrackPayOutSchema = mongoose.Schemas['wTrackPayOut'];
    var PaymentSchema = mongoose.Schemas['Payment'];
    var salaryPaymentSchema = mongoose.Schemas['salaryPayment'];
    var payrollSchema = mongoose.Schemas['PayRoll'];
    var JobsSchema = mongoose.Schemas['jobs'];
    var wTrackInvoiceSchema = mongoose.Schemas['wTrackInvoice'];
    var payRollInvoiceSchema = mongoose.Schemas['payRollInvoice'];
    var InvoiceSchema = mongoose.Schemas['Invoice'];
    var DepartmentSchema = mongoose.Schemas['Department'];
    var wTrackSchema = mongoose.Schemas['wTrack'];

    var objectId = mongoose.Types.ObjectId;
    var waterfallTasks;

    function checkDb(db) {
        var validDbs = ["weTrack", "production", "development"];

        return validDbs.indexOf(db) !== -1;
    }

    function returnModuleId(req) {
        var body = req.body;
        var moduleId;
        var type = req.params.byType;

        moduleId = (type === 'customers') ? 61 : (type === 'supplier') ? 60 : 79;

        return moduleId;
    }

    function returnModel(req, options) {
        var moduleId = returnModuleId(req);
        var Payment;

        options = options || {};

        if (options.isWtrack) {
            if (moduleId === 61) {
                Payment = models.get(req.session.lastDb, 'Payment', PaymentSchema);
            } else if (moduleId === 79) {
                Payment = models.get(req.session.lastDb, 'salaryPayment', salaryPaymentSchema);
            } else if (moduleId === 60) {
                Payment = models.get(req.session.lastDb, 'wTrackPayOut', wTrackPayOutSchema);
            }
        } else {
            Payment = models.get(req.session.lastDb, 'Payment', PaymentSchema);
        }

        return Payment;
    };

    function caseFilter(filter) {
        var condition;
        var resArray = [];
        var filtrElement = {};
        var key;

        for (var filterName in filter) {
            condition = filter[filterName]['value'] ? filter[filterName]['value'] : [];
            key = filter[filterName]['key'];

            switch (filterName) {
                case 'assigned':
                    filtrElement[key] = {$in: condition.objectID()};
                    resArray.push(filtrElement);
                    break;
                case 'name':
                    filtrElement[key] = {$in: condition.objectID()};
                    resArray.push(filtrElement);
                    break;
                case 'supplier':
                    filtrElement[key] = {$in: condition.objectID()};
                    resArray.push(filtrElement);
                    break;
                case 'paymentMethod':
                    filtrElement[key] = {$in: condition.objectID()};
                    resArray.push(filtrElement);
                    break;
                case 'workflow':
                    filtrElement[key] = {$in: condition};
                    resArray.push(filtrElement);
                    break;
                case 'forSale':
                    condition = ConvertType(condition, 'boolean');
                    filtrElement[key] = condition;
                    resArray.push(filtrElement);
                    break;
                case 'paymentRef':
                    filtrElement[key] = {$in: condition};
                    resArray.push(filtrElement);
                    break;
                case 'year':
                    ConvertType(condition, 'integer');
                    filtrElement[key] = {$in: condition};
                    resArray.push(filtrElement);
                    break;
                case 'month':
                    ConvertType(condition, 'integer');
                    filtrElement[key] = {$in: condition};
                    resArray.push(filtrElement);
                    break;
            }
        }

        return resArray;
    }

    function ConvertType(array, type) {
        if (type === 'integer') {
            for (var i = array.length - 1; i >= 0; i--) {
                array[i] = parseInt(array[i]);
            }
        } else if (type === 'boolean') {
            for (var i = array.length - 1; i >= 0; i--) {
                if (array[i] === 'true') {
                    array[i] = true;
                } else if (array[i] === 'false') {
                    array[i] = false;
                } else {
                    array[i] = null;
                }
            }
        }
    }

    function getPaymentFilter(req, res, next, options) {
        var isWtrack = checkDb(req.session.lastDb);
        var moduleId = returnModuleId(req);
        var data = req.query;
        var filter = data.filter;
        var forSale = options ? !!options.forSale : false;
        var bonus = options ? !!options.bonus : false;
        var salary = options ? !!options.salary : false;
        var Payment;
        var supplier = 'Customers';
        var paymentMethod = "PaymentMethod";

        options.isWtrack = isWtrack;
        Payment = returnModel(req, options);

        if (req.session && req.session.loggedIn && req.session.lastDb) {
            access.getReadAccess(req, req.session.uId, moduleId, function (access) {
                if (access) {

                    var optionsObject = {}; //{forSale: forSale};
                    var sort = {};
                    var count = parseInt(req.query.count) ? parseInt(req.query.count) : 100;
                    var page = parseInt(req.query.page);
                    var skip = (page - 1) > 0 ? (page - 1) * count : 0;

                    var departmentSearcher;
                    var contentIdsSearcher;
                    var contentSearcher;
                    var waterfallTasks;

                    if (req.query.sort) {
                        var key = Object.keys(req.query.sort)[0];
                        req.query.sort[key] = parseInt(req.query.sort[key]);
                        sort = req.query.sort;
                    } else {
                        sort = {"date": -1};
                    }

                    optionsObject.$and = [];

                    if (filter && typeof filter === 'object') {
                        if (filter.condition === 'or') {
                            optionsObject['$or'] = caseFilter(filter);
                        } else {
                            optionsObject['$and'] = caseFilter(filter);
                        }
                    }

                    if (!salary) {
                        optionsObject.$and.push({forSale: forSale});
                    } else {
                        optionsObject.$and.push({isExpense: true});
                        paymentMethod = 'ProductCategory';
                    }

                    if (bonus) {
                        optionsObject.$and.push({bonus: bonus});
                        supplier = "Employees"
                    }

                    departmentSearcher = function (waterfallCallback) {
                        models.get(req.session.lastDb, "Department", DepartmentSchema).aggregate(
                            {
                                $match: {
                                    users: objectId(req.session.uId)
                                }
                            }, {
                                $project: {
                                    _id: 1
                                }
                            },
                            waterfallCallback);
                    };

                    contentIdsSearcher = function (deps, waterfallCallback) {
                        var everyOne = rewriteAccess.everyOne();
                        var owner = rewriteAccess.owner(req.session.uId);
                        var group = rewriteAccess.group(req.session.uId, deps);
                        var whoCanRw = [everyOne, owner, group];
                        var matchQuery = {
                            $and: [
                                //optionsObject,
                                {
                                    $or: whoCanRw
                                }
                            ]
                        };

                        Payment.aggregate(
                            {
                                $match: matchQuery
                            },
                            {
                                $project: {
                                    _id: 1
                                }
                            },
                            waterfallCallback
                        );
                    };

                    contentSearcher = function (paymentsIds, waterfallCallback) {
                        optionsObject['$and'].push({_id: {$in: _.pluck(paymentsIds, '_id')}});

                        Payment.aggregate([{
                            $lookup: {
                                from        : supplier,
                                localField  : "supplier",
                                foreignField: "_id", as: "supplier"
                            }
                        }, {
                            $lookup: {
                                from        : "Invoice",
                                localField  : "invoice",
                                foreignField: "_id", as: "invoice"
                            }
                        }, {
                            $lookup: {
                                from        : paymentMethod,
                                localField  : "paymentMethod",
                                foreignField: "_id", as: "paymentMethod"
                            }
                        }, {
                            $project: {
                                supplier        : {$arrayElemAt: ["$supplier", 0]},
                                invoice         : {$arrayElemAt: ["$invoice", 0]},
                                paymentMethod   : {$arrayElemAt: ["$paymentMethod", 0]},
                                forSale         : 1,
                                differenceAmount: 1,
                                paidAmount      : 1,
                                workflow        : 1,
                                date            : 1,
                                isExpense       : 1,
                                bonus           : 1,
                                paymentRef      : 1,
                                year            : 1,
                                month           : 1,
                                period: 1
                            }
                        }, {
                            $lookup: {
                                from        : "Employees",
                                localField  : "invoice.salesPerson",
                                foreignField: "_id", as: "assigned"
                            }
                        }, {
                            $project: {
                                supplier        : 1,
                                invoice         : 1,
                                assigned        : {$arrayElemAt: ["$assigned", 0]},
                                forSale         : 1,
                                differenceAmount: 1,
                                paidAmount      : 1,
                                workflow        : 1,
                                date            : 1,
                                paymentMethod   : 1,
                                isExpense       : 1,
                                bonus           : 1,
                                paymentRef      : 1,
                                year            : 1,
                                month           : 1,
                                period: 1

                            }
                        }, {
                            $match: optionsObject
                        }, {
                            $sort: sort
                        }, {
                            $skip: skip
                        }, {
                            $limit: count
                        }
                        ], waterfallCallback);
                    };

                    waterfallTasks = [departmentSearcher, contentIdsSearcher, contentSearcher];

                    async.waterfall(waterfallTasks, function (err, result) {
                        if (err) {
                            return next(err);
                        }
                        res.status(200).send(result);
                    });
                } else {
                    res.send(403);
                }
            });

        } else {
            res.send(401);
        }
    }

    this.getById = function (req, res, next) {
        var id = req.params.id;
        var Payment;
        var query;
        var moduleId = returnModuleId(req);

        if (moduleId === 79){
            Payment = models.get(req.session.lastDb, 'salaryPayment', salaryPaymentSchema);
        } else {
            Payment = models.get(req.session.lastDb, 'Payment', PaymentSchema);
        }

        access.getReadAccess(req, req.session.uId, moduleId, function (access) {
            if (access) {

                query = Payment.findById(id);

                query
                    .populate('supplier', '_id name fullName')
                    .populate('paymentMethod', '_id name');

                query.exec(function (err, payment) {
                    if (err) {
                        return next(err);
                    }
                    res.status(200).send({success: payment});
                });
            } else {
                res.status(403).send();
            }
        });
    };

    this.getAll = function (req, res, next) {
        //this temporary unused
        var Payment;

        Payment = models.get(req.session.lastDb, 'Payment', PaymentSchema);

        var query = {};

        Payment.find(query, function (err, payments) {
            if (err) {
                return next(err);
            }
            res.status(200).send({success: payments});
        });
    };

    this.getForView = function (req, res, next) {
        var viewType = req.params.viewType;
        var type = req.params.byType;
        var forSale = type === 'customers';
        var bonus = type === 'supplier';
        var salary = type === 'salary';
        var options = {
            forSale: forSale,
            bonus  : bonus,
            salary : salary
        };

        switch (viewType) {
            case "list":
                getPaymentFilter(req, res, next, options);
                break;
        }
    };

    this.createPayOut = function (req, res, next) {
        var body = req.body;

        var moduleId = returnModuleId(req);
        var isWtrack = checkDb(req.session.lastDb);

        var Payment;

        if (isWtrack) {
            Payment = models.get(req.session.lastDb, 'wTrackPayOut', wTrackPayOutSchema);
        } else {
            Payment = models.get(req.session.lastDb, 'Payment', PaymentSchema);
        }

        access.getEditWritAccess(req, req.session.uId, moduleId, function (access) {
            if (access) {
                var payment = new Payment(body);

                payment.save(function (err, payment) {
                    if (err) {
                        return next(err);
                    }

                    res.status(200).send(payment);
                });

            } else {
                res.status(403).send();
            }
        });

    };

    function payrollExpensUpdater(db, _payment, mulParram, cb) {
        var Payroll = models.get(db, 'PayRoll', payrollSchema);
        var id = _payment.paymentRef ? _payment.paymentRef : _payment.product;
        var paid = _payment.paidAmount ? _payment.paidAmount : _payment.paid;

        paid = paid * mulParram;

        Payroll.findByIdAndUpdate(id, {
            $inc: {
                diff: paid,
                paid: paid
            }
        }, cb);
    }

    this.salaryPayOut = function (req, res, next) {
        var db = req.session.lastDb;
        var body = req.body;
        //var salaryPayment = body[0];
        var moduleId = 66;
        var Payment = models.get(req.session.lastDb, 'salaryPayment', salaryPaymentSchema);
        var Invoice = models.get(req.session.lastDb, 'payRollInvoice', payRollInvoiceSchema);

        access.getEditWritAccess(req, req.session.uId, moduleId, function (access) {
            if (access) {
                var mapBody = function (cb) {
                    var totalAmount = 0;
                    var suppliers = [];
                    var products = [];
                    var resultObject = {};

                    _.map(body, function (_payment) {
                        var supplierObject = _payment.supplier;
                        var productObject = {};

                        productObject.product = _payment.paymentRef;
                        productObject.paid = _payment.paidAmount;
                        productObject.diff = _payment.diff;

                        supplierObject.paidAmount = _payment.paidAmount;
                        supplierObject.differenceAmount = _payment.differenceAmount;

                        totalAmount += _payment.paidAmount;
                        suppliers.push(supplierObject);
                        products.push(productObject);

                        return true;
                    })

                    resultObject.suppliers = suppliers;
                    resultObject.products = products;
                    resultObject.totalAmount = totalAmount;

                    cb(null, resultObject);
                };

                var createInvoice = function (params, cb) {
                    var invoice = new Invoice({products: params.products});

                    invoice.save(function (err, result) {
                        if (err) {
                            return cb(err);
                        }

                        params.invoice = result;
                        cb(null, params);
                    });
                };

                var createPayment = function (params, cb) {
                    var paymentObject = _.clone(body[0]);
                    var payment;

                    paymentObject.invoice = params.invoice.get('_id');

                    paymentObject.supplier = params.suppliers;
                    paymentObject.paidAmount = params.totalAmount;

                    payment = new Payment(paymentObject);
                    payment.save(function (err, result) {
                        if (err) {
                            return cb(err);
                        }

                        cb(null, result);
                    });
                };

                var updatePayRolls = function (params, cb) {
                    async.each(body, function (_payment, eachCb) {
                        payrollExpensUpdater(db, _payment, 1, eachCb);
                    }, function (err) {
                        if (err) {
                            return cb(err);
                        }

                        cb(null, 'Done');
                    })
                };

                var waterFallTasks = [mapBody, createInvoice, createPayment, updatePayRolls];

                async.waterfall(waterFallTasks, function (err, result) {
                    if (err) {
                        return next(err);
                    }

                    res.status(201).send({success: 'success'});
                    composeExpensesAndCache(req);
                });
            } else {
                res.status(403).send();
            }
        });
    };

    this.create = function (req, res, next) {
        var body = req.body;
        var Invoice = models.get(req.session.lastDb, 'wTrackInvoice', wTrackInvoiceSchema);
        var JobsModel = models.get(req.session.lastDb, 'jobs', JobsSchema);
        var workflowHandler = new WorkflowHandler(models);
        var invoiceId = body.invoice;
        var DbName = req.session.lastDb;
        var mid = body.mid;
        var data = body;
        var project;
        //var type = "Paid";

        delete  data.mid;

        var moduleId = returnModuleId(req);
        var Payment;

        Payment = models.get(req.session.lastDb, 'Payment', PaymentSchema);

        function fetchInvoice(waterfallCallback) {
            Invoice.findById(invoiceId, waterfallCallback);
        }

        function savePayment(invoice, waterfallCallback) {
            var payment = new Payment(data);

            //payment.paidAmount = invoice.paymentInfo ? invoice.paymentInfo.total : 0;
            //payment.name = invoice.sourceDocument;
            payment.whoCanRW = invoice.whoCanRW;
            payment.groups = invoice.groups;
            payment.createdBy.user = req.session.uId;
            payment.editedBy.user = req.session.uId;

            payment.save(function (err, payment) {
                if (err) {
                    return waterfallCallback(err);
                }
                waterfallCallback(null, invoice, payment);
            });
        }

        function invoiceUpdater(invoice, payment, waterfallCallback) {
            var totalToPay = (invoice.paymentInfo) ? invoice.paymentInfo.balance : 0;
            var paid = payment.paidAmount;
            var isNotFullPaid;
            var wId;
            var payments;
            var products = invoice.products;
            var paymentDate = new Date(payment.date);

            if (paymentDate === 'Invalid Date') {
                paymentDate = new Date();
            }

            if (invoice._type === 'wTrackInvoice') {
                wId = 'Sales Invoice';
            } else {
                wId = 'Purchase Invoice';
            }
            var request = {
                query  : {
                    wId         : wId,
                    source      : 'purchase',
                    targetSource: 'invoice'
                },
                session: req.session
            };

            totalToPay = parseFloat(totalToPay);
            paid = parseFloat(paid);

            isNotFullPaid = paid < totalToPay;

            if (isNotFullPaid) {
                request.query.status = 'In Progress';
                request.query.order = 1;
            } else {
                request.query.status = 'Done';
                request.query.order = 1;
            }

            workflowHandler.getFirstForConvert(request, function (err, workflow) {
                if (err) {
                    return waterfallCallback(err);
                }

                invoice.workflow = workflow._id;
                invoice.paymentInfo.balance = (totalToPay - paid) / 100;
                // invoice.paymentInfo.unTaxed += paid / 100;// commented by Liliya forRoman
                // invoice.paymentInfo.unTaxed = paid * (1 + invoice.paymentInfo.taxes);
                invoice.payments.push(payment._id);

                invoice.paymentDate = new Date(paymentDate); //Because we have it in post.schema

                delete invoice.paymentDate;

                Invoice.findByIdAndUpdate(invoiceId, invoice, {new: true}, function (err, invoice) {
                    if (err) {
                        return waterfallCallback(err);
                    }

                    project = invoice ? invoice.get('project') : null;

                    payments = invoice ? invoice.get('payments') : [];

                    async.each(products, function (porduct) {
                        var job = porduct.jobs;

                        JobsModel.findByIdAndUpdate(job, {$set: {payments: payments}}, {new: true}, function (err, result) {
                            if (err) {
                                return next(err);
                            }
                        })

                    });

                    if (project) {
                        event.emit('fetchInvoiceCollection', {project: project});
                    }

                    waterfallCallback(null, invoice, payment);
                });
            });
        }

        function updateWtrack(invoice, payment, waterfallCallback) {
            var paid = payment.paidAmount || 0;
            var wTrackIds = _.pluck(invoice.products, 'product');

            function updateWtrack(id, cb) {
                var wTrack = models.get(req.session.lastDb, 'wTrack', wTrackSchema);

                function wTrackFinder(innerWaterfallCb) {
                    wTrack.findById(id, function (err, wTrackDoc) {
                        if (err) {
                            return innerWaterfallCb(err);
                        }
                        innerWaterfallCb(null, wTrackDoc);
                    });
                }

                function wTrackUpdater(wTrackDoc, innerWaterfallCb) {
                    var wTrackAmount;
                    var revenue;
                    var differance;
                    var isPaid;
                    if (!wTrackDoc) {

                        return innerWaterfallCb();
                    }

                    if (!wTrackDoc.isPaid) {
                        revenue = wTrackDoc.revenue;
                        wTrackAmount = wTrackDoc.amount;
                        differance = wTrackAmount - revenue; //differance - negative value

                        if ((paid + differance) >= 0) {
                            differance = -differance;
                        } else {
                            differance = paid;
                        }

                        paid -= differance;
                        wTrackAmount += differance;
                        isPaid = revenue === wTrackAmount;

                        wTrackDoc.amount = wTrackAmount / 100;
                        wTrackDoc.isPaid = isPaid;
                        wTrackDoc.save(function (err, saved) {
                            if (err) {
                                return innerWaterfallCb(err);
                            }
                            innerWaterfallCb(null, payment);
                        });
                    } else {
                        innerWaterfallCb(null, payment);
                    }
                }

                async.waterfall([wTrackFinder, wTrackUpdater], cb);
            }

            if (!paid) {
                return waterfallCallback(null, payment);
            }

            async.eachSeries(wTrackIds, updateWtrack, function (err, result) {
                if (err) {
                    return waterfallCallback(err);
                }

                waterfallCallback(null, payment);
            });

        }

        waterfallTasks = [fetchInvoice, savePayment, invoiceUpdater];

        if ((DbName === MAINCONSTANTS.WTRACK_DB_NAME) || (DbName === "production") || (DbName === "development")) {
            waterfallTasks.push(updateWtrack);
        }

        access.getEditWritAccess(req, req.session.uId, moduleId, function (access) {
            if (access) {
                async.waterfall(waterfallTasks, function (err, response) {
                    if (err) {
                        return next(err);
                    }

                    res.status(201).send(response);
                });
            } else {
                res.status(403).send();
            }
        });
    };

    this.totalCollectionLength = function (req, res, next) {
        var type = req.params.byType;
        var forSale = type === 'customers';
        var bonus = type === 'supplier';
        var salary = type === 'salary';
        var supplier = 'Customers';
        var paymentMethod = 'PaymentMethod';

        var queryObject = {};
        var filter = req.query.filter;

        var departmentSearcher;
        var contentIdsSearcher;

        var contentSearcher;
        var waterfallTasks;

        var isWtrack = checkDb(req.session.lastDb);
        var options = {
            forSale : forSale,
            bonus   : bonus,
            salary  : salary,
            isWtrack: isWtrack
        };
        var Payment;

        Payment = returnModel(req, options);

        queryObject.$and = [];

        if (bonus) {
            queryObject.bonus = bonus;
            supplier = 'Employees';
        }

        if (filter && typeof filter === 'object') {
            if (filter.condition === 'or') {
                queryObject['$or'] = caseFilter(filter);
            } else {
                queryObject['$and'] = caseFilter(filter);
            }
        }

        if (!salary) {
            queryObject.$and.push({forSale: forSale});
        } else {
            queryObject.$and.push({isExpense: true});
            paymentMethod = 'ProductCategory';
        }

        departmentSearcher = function (waterfallCallback) {
            models.get(req.session.lastDb, "Department", DepartmentSchema).aggregate(
                {
                    $match: {
                        users: objectId(req.session.uId)
                    }
                }, {
                    $project: {
                        _id: 1
                    }
                },

                waterfallCallback);
        };

        contentIdsSearcher = function (deps, waterfallCallback) {
            var everyOne = rewriteAccess.everyOne();
            var owner = rewriteAccess.owner(req.session.uId);
            var group = rewriteAccess.group(req.session.uId, deps);
            var whoCanRw = [everyOne, owner, group];
            var matchQuery = {
                $and: [
                    queryObject,
                    {
                        $or: whoCanRw
                    }
                ]
            };
            var Model = models.get(req.session.lastDb, "Payment", PaymentSchema);

            Model.aggregate(
                {
                    $match: matchQuery
                },
                {
                    $project: {
                        _id: 1
                    }
                },
                waterfallCallback
            );
        };

        contentSearcher = function (paymentIds, waterfallCallback) {
            var query;

            //query = Payment.find(queryObject);
            //query.count(waterfallCallback);

            Payment.aggregate([{
                $lookup: {
                    from        : supplier,
                    localField  : "supplier",
                    foreignField: "_id", as: "supplier"
                }
            }, {
                $lookup: {
                    from        : "Invoice",
                    localField  : "invoice",
                    foreignField: "_id", as: "invoice"
                }
            }, {
                $lookup: {
                    from        : paymentMethod,
                    localField  : "paymentMethod",
                    foreignField: "_id", as: "paymentMethod"
                }
            }, {
                $project: {
                    supplier        : {$arrayElemAt: ["$supplier", 0]},
                    invoice         : {$arrayElemAt: ["$invoice", 0]},
                    paymentMethod   : {$arrayElemAt: ["$paymentMethod", 0]},
                    forSale: 1,
                    isExpense: 1,
                    bonus: 1
                }
            }, {
                $lookup: {
                    from        : "Employees",
                    localField  : "invoice.salesPerson",
                    foreignField: "_id", as: "assigned"
                }
            }, {
                $project: {
                    supplier        : 1,
                    assigned        : {$arrayElemAt: ["$assigned", 0]},
                    paymentMethod   : 1,
                    invoice: 1,
                    forSale: 1,
                    isExpense: 1,
                    bonus: 1
                }
            }, {
                $match: queryObject
            }
            ], waterfallCallback);
        };

        waterfallTasks = [departmentSearcher, contentIdsSearcher, contentSearcher];

        async.waterfall(waterfallTasks, function (err, result) {
            if (err) {
                return next(err);
            }

            res.status(200).send({count: result.length});
        });
    };

    this.putchBulk = function (req, res, next) {
        var body = req.body;
        var contentType = req.params.contentType;
        var uId;
        var invoiceId;
        var paid;
        var Invoice = models.get(req.session.lastDb, 'wTrackInvoice', wTrackInvoiceSchema);
        var paymentInfo;
        var wId;
        var request;
        var isNotFullPaid;
        var workflowObj = {};
        var paymentInfoNew = {};
        var forSale = contentType === 'customers';
        var bonus = contentType === 'supplier';
        var salary = contentType === 'salary';
        var isWtrack = checkDb(req.session.lastDb);
        var workflowHandler = new WorkflowHandler(models);
        var JobsModel = models.get(req.session.lastDb, 'jobs', JobsSchema);
        var type = "Invoiced";
        var project;
        var options = {
            forSale : forSale,
            bonus   : bonus,
            salary  : salary,
            isWtrack: isWtrack
        };
        var Payment;

        Payment = returnModel(req, options);

        var moduleId = returnModuleId(req);

        if (req.session && req.session.loggedIn && req.session.lastDb) {
            uId = req.session.uId;
            access.getEditWritAccess(req, req.session.uId, moduleId, function (access) {
                if (access) {
                    async.each(body, function (data, cb) {
                        var id = data._id;

                        data.editedBy = {
                            user: uId,
                            date: new Date().toISOString()
                        };

                        if (moduleId === 60) {
                            delete data.paid;
                            delete data.differenceAmount;
                            delete data.paidAmount;
                        }

                        delete data._id;
                        Payment.findByIdAndUpdate(id, {$set: data}, {new: true}, function (err, payment) {
                            invoiceId = payment ? payment.get('invoice') : null;
                            paid = payment ? payment.get('paidAmount') : 0;

                            if (invoiceId && (payment._type !== 'salaryPayment')) {

                                if (isWtrack) {
                                    Invoice = models.get(req.session.lastDb, 'wTrackInvoice', wTrackInvoiceSchema);
                                } else {
                                    Invoice = models.get(req.session.lastDb, 'Invoice', InvoiceSchema);
                                }

                                Invoice.findById({_id: invoiceId}, function (err, invoice) {
                                    if (err) {
                                        return next(err);
                                    }

                                    paymentInfo = invoice.get('paymentInfo');

                                    if (invoice._type === 'wTrackInvoice') {
                                        wId = 'Sales Invoice';
                                    } else {
                                        wId = 'Purchase Invoice';
                                    }

                                    request = {
                                        query  : {
                                            wId         : wId,
                                            source      : 'purchase',
                                            targetSource: 'invoice'
                                        },
                                        session: req.session
                                    };

                                    isNotFullPaid = paymentInfo.total > (paymentInfo.balance + paid);

                                    if (isNotFullPaid) {
                                        request.query.status = 'In Progress';
                                        request.query.order = 1;
                                    } else {
                                        request.query.status = 'New';
                                        request.query.order = 1;
                                    }

                                    workflowHandler.getFirstForConvert(request, function (err, workflow) {
                                        if (err) {
                                            return next(err);
                                        }

                                        workflowObj = workflow._id;

                                        paymentInfoNew.total = paymentInfo.total;
                                        paymentInfoNew.taxes = paymentInfo.taxes;
                                        paymentInfoNew.unTaxed = paymentInfoNew.total;

                                        if (paymentInfo.total !== paymentInfo.balance) {
                                            paymentInfoNew.balance = paymentInfo.balance + paid;
                                        } else {
                                            paymentInfoNew.balance = paymentInfo.balance;
                                        }
                                        Invoice.findByIdAndUpdate(invoiceId, {
                                            $set: {
                                                workflow   : workflowObj,
                                                paymentInfo: paymentInfoNew
                                            }
                                        }, {new: true}, function (err, result) {
                                            if (err) {
                                                return next(err);
                                            }

                                            var products = result.get('products');

                                            async.each(products, function (product, callBack) {

                                                JobsModel.findByIdAndUpdate(product.jobs, {type: type}, {new: true}, function (err, result) {
                                                    if (err) {
                                                        return next(err);
                                                    }

                                                    project = result ? result.get('project') : null;

                                                    callBack();
                                                });

                                            }, function () {
                                                if (project) {
                                                    event.emit('fetchJobsCollection', {project: project});
                                                    event.emit('fetchInvoiceCollection', {project: project});
                                                }
                                            });
                                        });
                                    });
                                });
                            }
                            cb();
                        });
                    }, function (err) {
                        if (err) {
                            return next(err);
                        }

                        res.status(200).send({success: 'updated'});
                    });
                } else {
                    res.status(403).send();
                }
            });
        } else {
            res.status(401).send();
        }
    };

    this.remove = function (req, res, next) {
        var db = req.session.lastDb;
        var id = req.params.id;
        var isWtrack = checkDb(req.session.lastDb);
        var Payment;
        var Invoice;
        var invoiceId;
        var paid;
        var workflowObj;
        var paymentInfo;
        var paymentInfoNew = {};
        var wId;
        var request;
        var project;
        var moduleId = req.headers.mid || returnModuleId(req);
        var workflowHandler = new WorkflowHandler(models);
        var JobsModel = models.get(req.session.lastDb, 'jobs', JobsSchema);
        var type = "Invoiced";
        var isNotFullPaid;
        var payments;

        moduleId = parseInt(moduleId);

        Payment = models.get(req.session.lastDb, 'Payment', PaymentSchema);

        access.getDeleteAccess(req, req.session.uId, moduleId, function (access) {
            if (access) {
                Payment.findByIdAndRemove(id, function (err, removed) {
                    if (err) {
                        return next(err);
                    }

                    invoiceId = removed ? removed.get('invoice') : null;
                    paid = removed ? removed.get('paidAmount') : 0;

                    if (invoiceId && (removed && removed._type !== 'salaryPayment')) {

                        if (isWtrack) {
                            Invoice = models.get(req.session.lastDb, 'wTrackInvoice', wTrackInvoiceSchema);
                        } else {
                            Invoice = models.get(req.session.lastDb, 'Invoice', InvoiceSchema);
                        }

                        Invoice.findByIdAndUpdate({_id: invoiceId}, {$pull: {payments: removed._id}}, function (err, invoice) {
                            if (err) {
                                return next(err);
                            }

                            paymentInfo = invoice.get('paymentInfo');

                            project = invoice ? invoice.get('project') : null;

                            if (invoice._type === 'wTrackInvoice') {
                                wId = 'Sales Invoice';
                            } else {
                                wId = 'Purchase Invoice';
                            }

                            request = {
                                query  : {
                                    wId         : wId,
                                    source      : 'purchase',
                                    targetSource: 'invoice'
                                },
                                session: req.session
                            };

                            isNotFullPaid = paymentInfo.total > (paymentInfo.balance + paid);

                            if (isNotFullPaid) {
                                request.query.status = 'In Progress';
                                request.query.order = 1;
                            } else {
                                request.query.status = 'New';
                                request.query.order = 1;
                            }

                            workflowHandler.getFirstForConvert(request, function (err, workflow) {
                                if (err) {
                                    return next(err);
                                }

                                workflowObj = workflow._id;

                                paymentInfoNew.total = paymentInfo.total;
                                paymentInfoNew.taxes = paymentInfo.taxes;
                                paymentInfoNew.unTaxed = paymentInfoNew.total;

                                if (paymentInfo.total !== paymentInfo.balance) {
                                    paymentInfoNew.balance = paymentInfo.balance + paid;
                                } else {
                                    paymentInfoNew.balance = paymentInfo.balance;
                                }

                                Invoice.findByIdAndUpdate(invoiceId, {
                                    $set: {
                                        workflow   : workflowObj,
                                        paymentInfo: paymentInfoNew
                                    }
                                }, {new: true}, function (err, result) {
                                    if (err) {
                                        return next(err);
                                    }

                                    var products = result.get('products');

                                    payments = result.get('payments') ? result.get('payments') : [];

                                    async.each(products, function (product) {

                                        JobsModel.findByIdAndUpdate(product.jobs, {payments: payments}, {new: true}, function (err, result) {
                                            if (err) {
                                                return next(err);
                                            }

                                            project = result ? result.get('project') : null;
                                        });

                                    });

                                    if (project) {
                                        event.emit('fetchInvoiceCollection', {project: project});
                                    }

                                    res.status(200).send({success: removed});
                                });
                            });
                        });
                    } else if (invoiceId) {
                        Invoice = models.get(req.session.lastDb, 'payRollInvoice', payRollInvoiceSchema);

                        Invoice.findByIdAndRemove(invoiceId, function (err, invoice) {
                            if (err) {
                                return next(err);
                            }

                            async.each(invoice.products, function (_payment, eachCb) {
                                payrollExpensUpdater(db, _payment, -1, eachCb);
                            }, function (err) {
                                if (err) {
                                    return next(err);
                                }

                                res.status(200).send({success: 'Done'});
                                composeExpensesAndCache(req);
                            })
                        })
                    } else {
                        res.status(200).send({success: 'Done'});
                    }
                });
            } else {
                res.send(403);
            }
        });

    };

    this.getForProject = function (req, res, next) {
        var ids = req.query.data;
        var Payment = models.get(req.session.lastDb, 'Payment', PaymentSchema);
        var moduleId = req.headers.mId || returnModuleId(req);

        access.getDeleteAccess(req, req.session.uId, moduleId, function (access) {
            if (access) {
                Payment.find({_id: {$in: ids}}, function (err, result) {
                    if (err) {
                        return next(err);
                    }

                    res.status(200).send(result);
                });
            } else {
                res.send(403);
            }
        });
    }

};

module.exports = Payment;