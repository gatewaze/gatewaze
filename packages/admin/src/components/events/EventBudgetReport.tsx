// @ts-nocheck
/**
 * Event Budget Report Component
 * Displays budget summary, cost breakdown by category, and marketing CPA analytics
 */

import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import Chart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';
import {
  CurrencyDollarIcon,
  ChartBarIcon,
  UserGroupIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GlobeAltIcon,
  BriefcaseIcon,
} from '@heroicons/react/24/outline';
import { BudgetService, BudgetSummary, MarketingCPA, MarketingCPASource, BreakdownItem } from '@/lib/services/budgetService';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui-legacy';

interface EventBudgetReportProps {
  eventId: string;
}

const EventBudgetReport = ({ eventId }: EventBudgetReportProps) => {
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary | null>(null);
  const [marketingCPA, setMarketingCPA] = useState<MarketingCPA | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  const toggleSourceExpansion = (categoryId: string) => {
    setExpandedSources(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  useEffect(() => {
    loadBudgetData();
  }, [eventId]);

  const loadBudgetData = async () => {
    setLoading(true);
    setError(null);
    try {
      const budgetService = new BudgetService(supabase);
      const [summary, cpa] = await Promise.all([
        budgetService.getBudgetSummary(eventId),
        budgetService.getMarketingCPA(eventId),
      ]);
      setBudgetSummary(summary);
      setMarketingCPA(cpa);
    } catch (err) {
      console.error('Error loading budget data:', err);
      setError('Failed to load budget data');
      toast.error('Failed to load budget data');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatCurrencyDecimal = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  if (loading) {
    return (
      <Card>
        <div className="p-6 flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="p-6 text-center text-red-500">
          <ExclamationTriangleIcon className="w-8 h-8 mx-auto mb-2" />
          <p>{error}</p>
          <button
            onClick={loadBudgetData}
            className="mt-2 text-sm text-blue-600 hover:underline"
          >
            Retry
          </button>
        </div>
      </Card>
    );
  }

  const hasData = budgetSummary && (budgetSummary.total_planned > 0 || budgetSummary.total_actual > 0);
  const hasMarketingData = marketingCPA?.sources && marketingCPA.sources.length > 0;

  // Calculate variance
  const variance = hasData ? budgetSummary.total_planned - budgetSummary.total_actual : 0;
  const variancePercentage = hasData && budgetSummary.total_planned > 0
    ? ((variance / budgetSummary.total_planned) * 100).toFixed(1)
    : null;
  const isOverBudget = variance < 0;

  // Category breakdown chart
  const categoryChartOptions: ApexOptions = {
    chart: {
      type: 'donut',
      toolbar: { show: false },
    },
    labels: budgetSummary?.by_category?.map(c => c.category_name) || [],
    colors: budgetSummary?.by_category?.map(c => c.color || '#6B7280') || [],
    legend: {
      position: 'bottom',
      fontSize: '12px',
    },
    dataLabels: {
      enabled: true,
      formatter: (val: number) => `${val.toFixed(0)}%`,
    },
    tooltip: {
      y: {
        formatter: (val: number) => formatCurrency(val),
      },
    },
    plotOptions: {
      pie: {
        donut: {
          size: '60%',
          labels: {
            show: true,
            total: {
              show: true,
              label: 'Total Spend',
              formatter: () => formatCurrency(budgetSummary?.total_actual || 0),
            },
          },
        },
      },
    },
  };

  const categoryChartSeries = budgetSummary?.by_category?.map(c => c.actual) || [];

  // Category type breakdown chart
  const categoryTypeChartOptions: ApexOptions = {
    chart: {
      type: 'bar',
      toolbar: { show: false },
      stacked: true,
    },
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 4,
      },
    },
    xaxis: {
      categories: budgetSummary?.by_category_type?.map(t =>
        t.category_type.charAt(0).toUpperCase() + t.category_type.slice(1)
      ) || [],
      labels: {
        formatter: (val: string) => formatCurrency(Number(val)),
      },
    },
    colors: ['#3B82F6', '#10B981'],
    legend: {
      position: 'top',
    },
    dataLabels: {
      enabled: false,
    },
    tooltip: {
      y: {
        formatter: (val: number) => formatCurrency(val),
      },
    },
  };

  const categoryTypeChartSeries = [
    {
      name: 'Actual',
      data: budgetSummary?.by_category_type?.map(t => t.actual) || [],
    },
    {
      name: 'Planned',
      data: budgetSummary?.by_category_type?.map(t => t.planned) || [],
    },
  ];

  return (
    <div className="space-y-6">
      {/* Budget Summary Header */}
      <Card>
        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
            <CurrencyDollarIcon className="w-6 h-6 text-green-600" />
            Budget Overview
          </h2>

          {hasData ? (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {formatCurrency(budgetSummary.total_planned)}
                  </div>
                  <div className="text-sm text-gray-500">Planned Budget</div>
                </div>
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {formatCurrency(budgetSummary.total_actual)}
                  </div>
                  <div className="text-sm text-gray-500">Actual Spend</div>
                </div>
                <div className={`p-4 rounded-lg ${isOverBudget ? 'bg-red-50 dark:bg-red-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
                  <div className={`text-2xl font-bold flex items-center gap-1 ${isOverBudget ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {isOverBudget ? (
                      <ArrowTrendingUpIcon className="w-5 h-5" />
                    ) : (
                      <ArrowTrendingDownIcon className="w-5 h-5" />
                    )}
                    {formatCurrency(Math.abs(variance))}
                  </div>
                  <div className="text-sm text-gray-500">
                    {isOverBudget ? 'Over Budget' : 'Under Budget'}
                  </div>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {variancePercentage ? `${variancePercentage}%` : '-'}
                  </div>
                  <div className="text-sm text-gray-500">Variance</div>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-2 gap-6">
                {/* Spend by Category */}
                {categoryChartSeries.length > 0 && categoryChartSeries.some(v => v > 0) && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                      Spend by Category
                    </h3>
                    <Chart
                      options={categoryChartOptions}
                      series={categoryChartSeries}
                      type="donut"
                      height={280}
                    />
                  </div>
                )}

                {/* Planned vs Actual by Type */}
                {budgetSummary?.by_category_type && budgetSummary.by_category_type.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                      Planned vs Actual by Type
                    </h3>
                    <Chart
                      options={categoryTypeChartOptions}
                      series={categoryTypeChartSeries}
                      type="bar"
                      height={280}
                    />
                  </div>
                )}
              </div>

              {/* Category Breakdown Table */}
              {budgetSummary?.by_category && budgetSummary.by_category.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    Category Breakdown
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Category</th>
                          <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Type</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Planned</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Actual</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Variance</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Items</th>
                        </tr>
                      </thead>
                      <tbody>
                        {budgetSummary.by_category.map((cat, idx) => {
                          const catVariance = cat.planned - cat.actual;
                          const isOver = catVariance < 0;
                          return (
                            <tr key={idx} className="border-b border-gray-100 dark:border-gray-800">
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: cat.color || '#6B7280' }}
                                  />
                                  <span className="text-gray-900 dark:text-white">{cat.category_name}</span>
                                </div>
                              </td>
                              <td className="py-2 px-3 text-gray-500 capitalize">{cat.category_type}</td>
                              <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">
                                {formatCurrency(cat.planned)}
                              </td>
                              <td className="py-2 px-3 text-right font-medium text-gray-900 dark:text-white">
                                {formatCurrency(cat.actual)}
                              </td>
                              <td className={`py-2 px-3 text-right font-medium ${isOver ? 'text-red-600' : 'text-green-600'}`}>
                                {isOver ? '-' : '+'}{formatCurrency(Math.abs(catVariance))}
                              </td>
                              <td className="py-2 px-3 text-right text-gray-500">{cat.line_item_count}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <CurrencyDollarIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No budget data available</p>
              <p className="text-sm mt-1">Add budget allocations and line items to see analytics</p>
            </div>
          )}
        </div>
      </Card>

      {/* Marketing CPA Analytics */}
      <Card>
        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
            <ChartBarIcon className="w-6 h-6 text-blue-600" />
            Marketing Source CPA
          </h2>

          {hasMarketingData ? (
            <>
              {/* CPA Summary */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Source</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Budget</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Spend</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">
                        <div className="flex items-center justify-end gap-1">
                          <UserGroupIcon className="w-4 h-4" />
                          Registrations
                        </div>
                      </th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">
                        CPA (Reg)
                      </th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">
                        <div className="flex items-center justify-end gap-1">
                          <UserGroupIcon className="w-4 h-4" />
                          Attendees
                        </div>
                      </th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">
                        CPA (Att)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketingCPA.sources.map((source, idx) => {
                      const isExpanded = expandedSources.has(source.category_id);
                      const hasBreakdownData = (source.registrations_by_country && source.registrations_by_country.length > 0) ||
                                           (source.registrations_by_job_title && source.registrations_by_job_title.length > 0);
                      // Always allow expansion if there are registrations (breakdown data may come from updated DB function)
                      const canExpand = source.registrations > 0;
                      return (
                        <React.Fragment key={source.category_id}>
                          <tr
                            className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${canExpand ? 'cursor-pointer' : ''}`}
                            onClick={() => canExpand && toggleSourceExpansion(source.category_id)}
                          >
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                {canExpand ? (
                                  isExpanded
                                    ? <ChevronUpIcon className="w-4 h-4 text-gray-400" />
                                    : <ChevronDownIcon className="w-4 h-4 text-gray-400" />
                                ) : (
                                  <div className="w-4 h-4" /> // Spacer for alignment
                                )}
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: source.color || '#6B7280' }}
                                />
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {source.category_name}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right text-gray-500">
                              {formatCurrency(source.planned_budget)}
                            </td>
                            <td className="py-3 px-3 text-right font-medium text-gray-900 dark:text-white">
                              {formatCurrency(source.actual_spend)}
                            </td>
                            <td className="py-3 px-3 text-right">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                                {source.registrations}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right">
                              {source.cpa_registration !== null ? (
                                <span className={`font-semibold ${
                                  source.cpa_registration <= 50 ? 'text-green-600' :
                                  source.cpa_registration <= 100 ? 'text-yellow-600' :
                                  'text-red-600'
                                }`}>
                                  {formatCurrencyDecimal(source.cpa_registration)}
                                </span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                {source.attendees}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right">
                              {source.cpa_attendee !== null ? (
                                <span className={`font-semibold ${
                                  source.cpa_attendee <= 75 ? 'text-green-600' :
                                  source.cpa_attendee <= 150 ? 'text-yellow-600' :
                                  'text-red-600'
                                }`}>
                                  {formatCurrencyDecimal(source.cpa_attendee)}
                                </span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          </tr>
                          {/* Expanded Breakdown Row */}
                          {isExpanded && canExpand && (
                            <tr key={`${idx}-breakdown`} className="bg-gray-50 dark:bg-gray-800/30">
                              <td colSpan={7} className="py-4 px-6">
                                <div className="grid grid-cols-2 gap-6">
                                  {/* Country Breakdown */}
                                  <div>
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                                      <GlobeAltIcon className="w-4 h-4" />
                                      By Country
                                    </h4>
                                    <div className="grid grid-cols-2 gap-4">
                                      {/* Registrations by Country */}
                                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                                        <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2">Registrations</div>
                                        <div className="space-y-1 max-h-32 overflow-y-auto">
                                          {(source.registrations_by_country || []).slice(0, 10).map((item, i) => (
                                            <div key={i} className="flex justify-between text-xs">
                                              <span className="text-blue-800 dark:text-blue-200 truncate">{item.country}</span>
                                              <span className="font-semibold text-blue-900 dark:text-blue-100 ml-2">{item.count}</span>
                                            </div>
                                          ))}
                                          {(source.registrations_by_country || []).length > 10 && (
                                            <div className="text-xs text-blue-500 italic">+{(source.registrations_by_country || []).length - 10} more</div>
                                          )}
                                        </div>
                                      </div>
                                      {/* Attendees by Country */}
                                      <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                                        <div className="text-xs font-medium text-green-700 dark:text-green-300 mb-2">Attendees</div>
                                        <div className="space-y-1 max-h-32 overflow-y-auto">
                                          {(source.attendees_by_country || []).slice(0, 10).map((item, i) => (
                                            <div key={i} className="flex justify-between text-xs">
                                              <span className="text-green-800 dark:text-green-200 truncate">{item.country}</span>
                                              <span className="font-semibold text-green-900 dark:text-green-100 ml-2">{item.count}</span>
                                            </div>
                                          ))}
                                          {(source.attendees_by_country || []).length > 10 && (
                                            <div className="text-xs text-green-500 italic">+{(source.attendees_by_country || []).length - 10} more</div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Job Title Breakdown */}
                                  <div>
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                                      <BriefcaseIcon className="w-4 h-4" />
                                      By Job Title
                                    </h4>
                                    <div className="grid grid-cols-2 gap-4">
                                      {/* Registrations by Job Title */}
                                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                                        <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2">Registrations</div>
                                        <div className="space-y-1 max-h-32 overflow-y-auto">
                                          {(source.registrations_by_job_title || []).slice(0, 10).map((item, i) => (
                                            <div key={i} className="flex justify-between text-xs">
                                              <span className="text-blue-800 dark:text-blue-200 truncate" title={item.job_title}>{item.job_title}</span>
                                              <span className="font-semibold text-blue-900 dark:text-blue-100 ml-2">{item.count}</span>
                                            </div>
                                          ))}
                                          {(source.registrations_by_job_title || []).length > 10 && (
                                            <div className="text-xs text-blue-500 italic">+{(source.registrations_by_job_title || []).length - 10} more</div>
                                          )}
                                        </div>
                                      </div>
                                      {/* Attendees by Job Title */}
                                      <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                                        <div className="text-xs font-medium text-green-700 dark:text-green-300 mb-2">Attendees</div>
                                        <div className="space-y-1 max-h-32 overflow-y-auto">
                                          {(source.attendees_by_job_title || []).slice(0, 10).map((item, i) => (
                                            <div key={i} className="flex justify-between text-xs">
                                              <span className="text-green-800 dark:text-green-200 truncate" title={item.job_title}>{item.job_title}</span>
                                              <span className="font-semibold text-green-900 dark:text-green-100 ml-2">{item.count}</span>
                                            </div>
                                          ))}
                                          {(source.attendees_by_job_title || []).length > 10 && (
                                            <div className="text-xs text-green-500 italic">+{(source.attendees_by_job_title || []).length - 10} more</div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  {/* Totals Row */}
                  <tfoot>
                    <tr className="bg-gray-50 dark:bg-gray-800/50 font-medium">
                      <td className="py-3 px-3 text-gray-900 dark:text-white">Total</td>
                      <td className="py-3 px-3 text-right text-gray-600 dark:text-gray-400">
                        {formatCurrency(marketingCPA.sources.reduce((sum, s) => sum + s.planned_budget, 0))}
                      </td>
                      <td className="py-3 px-3 text-right text-gray-900 dark:text-white">
                        {formatCurrency(marketingCPA.sources.reduce((sum, s) => sum + s.actual_spend, 0))}
                      </td>
                      <td className="py-3 px-3 text-right text-blue-600 dark:text-blue-400">
                        {marketingCPA.sources.reduce((sum, s) => sum + s.registrations, 0)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {(() => {
                          const totalSpend = marketingCPA.sources.reduce((sum, s) => sum + s.actual_spend, 0);
                          const totalRegs = marketingCPA.sources.reduce((sum, s) => sum + s.registrations, 0);
                          const avgCPA = totalRegs > 0 ? totalSpend / totalRegs : null;
                          return avgCPA !== null ? (
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {formatCurrencyDecimal(avgCPA)}
                            </span>
                          ) : '-';
                        })()}
                      </td>
                      <td className="py-3 px-3 text-right text-green-600 dark:text-green-400">
                        {marketingCPA.sources.reduce((sum, s) => sum + s.attendees, 0)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {(() => {
                          const totalSpend = marketingCPA.sources.reduce((sum, s) => sum + s.actual_spend, 0);
                          const totalAtts = marketingCPA.sources.reduce((sum, s) => sum + s.attendees, 0);
                          const avgCPA = totalAtts > 0 ? totalSpend / totalAtts : null;
                          return avgCPA !== null ? (
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {formatCurrencyDecimal(avgCPA)}
                            </span>
                          ) : '-';
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* CPA Visualization */}
              <div className="mt-6 grid grid-cols-2 gap-6">
                {/* Registrations by Source */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">
                    Registrations by Source
                  </h4>
                  <div className="space-y-2">
                    {marketingCPA.sources
                      .filter(s => s.registrations > 0)
                      .sort((a, b) => b.registrations - a.registrations)
                      .map((source, idx) => {
                        const maxRegs = Math.max(...marketingCPA.sources.map(s => s.registrations));
                        const percentage = maxRegs > 0 ? (source.registrations / maxRegs) * 100 : 0;
                        return (
                          <div key={idx} className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: source.color || '#6B7280' }}
                            />
                            <span className="text-sm text-blue-800 dark:text-blue-200 flex-1 truncate">
                              {source.category_name}
                            </span>
                            <div className="w-24 h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-600 dark:bg-blue-400 rounded-full"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-blue-900 dark:text-blue-100 w-8 text-right">
                              {source.registrations}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Attendees by Source */}
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <h4 className="text-sm font-semibold text-green-900 dark:text-green-100 mb-3">
                    Attendees by Source
                  </h4>
                  <div className="space-y-2">
                    {marketingCPA.sources
                      .filter(s => s.attendees > 0)
                      .sort((a, b) => b.attendees - a.attendees)
                      .map((source, idx) => {
                        const maxAtts = Math.max(...marketingCPA.sources.map(s => s.attendees));
                        const percentage = maxAtts > 0 ? (source.attendees / maxAtts) * 100 : 0;
                        return (
                          <div key={idx} className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: source.color || '#6B7280' }}
                            />
                            <span className="text-sm text-green-800 dark:text-green-200 flex-1 truncate">
                              {source.category_name}
                            </span>
                            <div className="w-24 h-2 bg-green-200 dark:bg-green-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-green-600 dark:bg-green-400 rounded-full"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-green-900 dark:text-green-100 w-8 text-right">
                              {source.attendees}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <ChartBarIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No marketing CPA data available</p>
              <p className="text-sm mt-1">Add marketing spend and track registration sources to see CPA analytics</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export { EventBudgetReport };
